/**
 * API server: guest sessions, account reads from Postgres, orders through the engine, cached candles,
 * and a WebSocket that streams ticks plus a nudge whenever a user's account changes.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import compression from "compression";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import {
  ASSETS, MAX_LEVERAGE, STARTING_BALANCE_CENTS, db, isAsset, log, migrate, rowToDTO,
  type Asset, type PositionRow, type Result, type Tick,
} from "@strata/shared";
import { latestTicks, onResult, onTicks, redisPing, send, startBus } from "./bus";
import { klines, INTERVALS } from "./klines";

const PORT = Number(process.env.PORT ?? 8000);
const JWT_SECRET = process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-only-secret");
if (!JWT_SECRET) throw new Error("JWT_SECRET is required in production");
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim());

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "8kb" }));
app.use(cors({ origin: ORIGINS, allowedHeaders: ["Content-Type", "Authorization"], maxAge: 600 }));
app.use((_req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); next(); });

// ---------------------------------------------------------------- tiny rate limiter

const buckets = new Map<string, { n: number; reset: number }>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return false; }
  return ++b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60_000).unref();

/** The platform's own client-IP header, else the last X-Forwarded-For hop (the one our proxy appended). */
function clientIp(req: Request): string {
  const direct = req.header("true-client-ip") ?? req.header("fly-client-ip");
  if (direct) return direct;
  const hops = (req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? req.socket.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------- auth

type Authed = Request & { userId: string };
const sign = (userId: string) => jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "90d" });
function verify(token: string | undefined): string | null {
  if (!token) return null;
  try { return (jwt.verify(token, JWT_SECRET) as { sub: string }).sub; } catch { return null; }
}
function auth(req: Request, res: Response, next: NextFunction) {
  const userId = verify(req.header("authorization")?.replace(/^Bearer /, ""));
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  (req as Authed).userId = userId;
  next();
}

/** A guest account funded with demo USDC. No email, no password. */
app.post("/api/v1/session", async (req, res) => {
  if (limited(`session:${clientIp(req)}`, 10, 60 * 60_000)) return res.status(429).json({ error: "too_many_accounts" });
  const userId = randomUUID();
  await db().query("insert into users (id, balance_cents) values ($1, $2)", [userId, STARTING_BALANCE_CENTS]);
  res.status(201).json({ token: sign(userId), userId });
});

// ---------------------------------------------------------------- market data

app.get("/api/v1/markets", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=1");
  res.json({
    markets: (Object.keys(ASSETS) as Asset[]).map((a) => ({ asset: a, name: ASSETS[a].name, tick: latestTicks.get(a) ?? null })),
  });
});

app.get("/api/v1/klines", async (req, res) => {
  const asset = String(req.query.asset ?? "").toUpperCase();
  const interval = String(req.query.interval ?? "1h");
  if (!isAsset(asset) || !(interval in INTERVALS)) return res.status(400).json({ error: "invalid_params", intervals: Object.keys(INTERVALS) });
  try {
    res.setHeader("Cache-Control", "public, max-age=10");
    res.json({ asset, interval, candles: await klines(asset, interval as keyof typeof INTERVALS) });
  } catch (e) {
    log("server", "klines failed", (e as Error).message);
    res.status(502).json({ error: "upstream_unavailable" });
  }
});

// ---------------------------------------------------------------- account

app.get("/api/v1/me", auth, async (req, res) => {
  const userId = (req as Authed).userId;
  const [user, openRows, closedRows] = await Promise.all([
    db().query<{ balance_cents: string }>("select balance_cents from users where id = $1", [userId]),
    db().query<PositionRow>("select * from positions where user_id = $1 and closed_at is null order by opened_at desc", [userId]),
    db().query<PositionRow>("select * from positions where user_id = $1 and closed_at is not null order by closed_at desc limit 25", [userId]),
  ]);
  if (!user.rows[0]) return res.status(401).json({ error: "unknown_user" });
  res.json({
    userId,
    balanceCents: Number(user.rows[0].balance_cents),
    positions: openRows.rows.map(rowToDTO),
    history: closedRows.rows.map(rowToDTO),
  });
});

const OpenOrder = z.object({
  asset: z.string().refine(isAsset),
  side: z.enum(["long", "short"]),
  margin: z.number().positive().max(1_000_000),
  leverage: z.number().int().min(1).max(MAX_LEVERAGE),
});

function reply(res: Response, r: Result | null, startedAt: number) {
  const ms = Date.now() - startedAt;
  if (!r) return res.status(504).json({ error: "engine_timeout", ms });
  if (r.kind === "rejected") return res.status(r.reason === "not_found" ? 404 : 409).json({ error: r.reason, ms });
  return res.json({ ...r, ms });
}

app.post("/api/v1/orders", auth, async (req, res) => {
  const userId = (req as Authed).userId;
  if (limited(`orders:${userId}`, 20, 10_000)) return res.status(429).json({ error: "slow_down" });
  const parsed = OpenOrder.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_order", issues: parsed.error.issues });
  const { asset, side, margin, leverage } = parsed.data;
  const started = Date.now();
  const r = await send({ kind: "open", id: randomUUID(), userId, asset: asset as Asset, side, marginCents: Math.round(margin * 100), leverage });
  reply(res, r, started);
});

app.post("/api/v1/positions/:id/close", auth, async (req, res) => {
  const userId = (req as Authed).userId;
  if (limited(`orders:${userId}`, 20, 10_000)) return res.status(429).json({ error: "slow_down" });
  const started = Date.now();
  reply(res, await send({ kind: "close", id: randomUUID(), userId, positionId: String(req.params.id) }), started);
});

app.post("/api/v1/reset", auth, async (req, res) => {
  const userId = (req as Authed).userId;
  if (limited(`reset:${userId}`, 5, 60_000)) return res.status(429).json({ error: "slow_down" });
  const started = Date.now();
  reply(res, await send({ kind: "reset", id: randomUUID(), userId }), started);
});

app.get("/health", async (_req, res) => {
  try {
    await Promise.all([redisPing(), db().query("select 1")]);
    res.json({ ok: true, markets: latestTicks.size });
  } catch (e) {
    res.status(503).json({ ok: false, error: (e as Error).message });
  }
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log("server", "unhandled", err.message);
  res.status(500).json({ error: "internal" });
});

// ---------------------------------------------------------------- websocket

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });
const socketsByUser = new Map<string, Set<WebSocket>>();
const alive = new WeakSet<WebSocket>();

function sendJson(ws: WebSocket, msg: unknown) {
  // A slow client skips ticks rather than buffering without limit.
  if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(JSON.stringify(msg));
}

wss.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  if (origin && !ORIGINS.includes(origin)) return ws.close(1008, "origin");
  const userId = verify(new URL(req.url ?? "/", "http://x").searchParams.get("token") ?? undefined);
  if (userId) (socketsByUser.get(userId) ?? socketsByUser.set(userId, new Set()).get(userId)!).add(ws);
  alive.add(ws);
  ws.on("pong", () => alive.add(ws));
  ws.on("close", () => { if (userId) socketsByUser.get(userId)?.delete(ws); });
  sendJson(ws, { type: "ticks", ticks: [...latestTicks.values()] });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) { ws.terminate(); continue; }
    alive.delete(ws);
    ws.ping();
  }
}, 30_000).unref();

onTicks((batch: Tick[]) => {
  if (wss.clients.size === 0) return;
  const latest = new Map(batch.map((t) => [t.asset, t]));
  const payload = JSON.stringify({ type: "ticks", ticks: [...latest.values()] });
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(payload);
});

onResult((r) => {
  const sockets = socketsByUser.get(r.userId);
  if (!sockets?.size) return;
  const msg = r.kind === "liquidated" ? { type: "account", event: "liquidated", position: r.position } : { type: "account", event: r.kind };
  for (const ws of sockets) sendJson(ws, msg);
});

// ---------------------------------------------------------------- start

async function main() {
  await migrate();
  startBus();
  server.listen(PORT, () => log("server", `listening on ${PORT}`));
}
main().catch((e) => { log("server", "fatal", e); process.exit(1); });
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { server.close(); process.exit(0); });
