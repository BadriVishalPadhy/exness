/**
 * Poller: subscribes to Backpack's ticker stream and publishes the latest price per market to the
 * "prices" Redis stream every 100 ms when something changed, and every market at least every 5 s.
 */
import WebSocket from "ws";
import { ASSETS, STREAM, encode, log, redisClient, type Asset, type Tick } from "@strata/shared";

const FLUSH_MS = 100;
const STALE_MS = 15_000; // reconnect if the feed goes quiet this long
const HEARTBEAT_MS = 5_000; // re-send unchanged markets so consumers can tell quiet from stale
const redis = redisClient("poller");
const bySymbol = new Map<string, Asset>(Object.entries(ASSETS).map(([a, c]) => [c.symbol, a as Asset]));

const latest = new Map<Asset, Tick>();
const dirty = new Set<Asset>();
const publishedAt = new Map<Asset, number>();
let lastMessageAt = Date.now();
let attempt = 0;

function connect() {
  const ws = new WebSocket("wss://ws.backpack.exchange/");
  let watchdog: NodeJS.Timeout | undefined;

  ws.on("open", () => {
    attempt = 0;
    lastMessageAt = Date.now();
    ws.send(JSON.stringify({ method: "SUBSCRIBE", params: Object.values(ASSETS).map((a) => `ticker.${a.symbol}`) }));
    log("poller", "connected to Backpack");
    watchdog = setInterval(() => {
      if (Date.now() - lastMessageAt > STALE_MS) { log("poller", "feed stale, reconnecting"); ws.terminate(); }
    }, 5_000);
  });

  ws.on("message", (raw) => {
    lastMessageAt = Date.now();
    let msg: { stream?: string; data?: Record<string, string | number> };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const d = msg.data;
    if (!d || !msg.stream?.startsWith("ticker.")) return;
    const asset = bySymbol.get(String(d.s));
    if (!asset) return;
    const price = Number(d.c);
    if (!Number.isFinite(price) || price <= 0) return;
    const prev = latest.get(asset);
    if (prev && prev.price === price) return;
    latest.set(asset, {
      asset, price, open24h: Number(d.o), high24h: Number(d.h), low24h: Number(d.l), volume24h: Number(d.V),
      ts: Math.floor(Number(d.E) / 1000) || Date.now(),
    });
    dirty.add(asset);
  });

  ws.on("close", () => {
    clearInterval(watchdog);
    const delay = Math.min(30_000, 500 * 2 ** attempt++);
    log("poller", `disconnected, retrying in ${delay} ms`);
    setTimeout(connect, delay);
  });
  ws.on("error", (e) => log("poller", "websocket error", e.message));
}

async function flush() {
  const now = Date.now();
  for (const [asset] of latest) if (now - (publishedAt.get(asset) ?? 0) > HEARTBEAT_MS) dirty.add(asset);
  if (dirty.size === 0) return;
  const ticks = [...dirty].map((a) => latest.get(a)!);
  dirty.clear();
  for (const t of ticks) publishedAt.set(t.asset, now);
  try {
    // Approximate trimming keeps the stream bounded without slowing every XADD.
    await redis.xadd(STREAM.prices, "MAXLEN", "~", 1000, "*", ...encode(ticks));
  } catch (e) {
    log("poller", "publish failed", (e as Error).message);
    for (const t of ticks) dirty.add(t.asset);
  }
}

setInterval(flush, FLUSH_MS);
connect();

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { redis.disconnect(); process.exit(0); });
