/**
 * Engine: the single owner of balances and positions.
 *
 * - Prices arrive on the "prices" stream; every tick re-checks liquidations for that market.
 * - Commands arrive on the "commands" stream through the "engine" consumer group, up to 200 at a time.
 * - Group commit: a whole batch is applied in memory, then written to Postgres in ONE statement,
 *   then its results are published and its entries XACKed in one Redis round trip. Throughput scales
 *   with batch size instead of being capped by database latency.
 * - A command is XACKed only after its effect is committed, so a crash replays unfinished commands
 *   from the pending list. If a commit fails the process exits and rebuilds state from Postgres.
 * - All state changes run through one serial queue, so a liquidation can never race a user's close.
 */
import {
  ENGINE_GROUP, STARTING_BALANCE_CENTS, STREAM, db, decode, encode, isAsset, liquidationPrice, log, migrate, pnlCents,
  redisClient, rowToDTO, type Asset, type Command, type PositionDTO, type PositionRow, type RejectReason, type Result, type Tick,
} from "@strata/shared";

const CONSUMER = `engine-${process.pid}`;
const BATCH = Number(process.env.ENGINE_BATCH ?? 200);
const MAX_PRICE_AGE_MS = 30_000;

const writer = redisClient("engine");
const priceReader = redisClient("engine-prices");
const commandReader = redisClient("engine-commands");

interface Position extends PositionDTO { userId: string; closing?: boolean }

const prices = new Map<Asset, { price: number; at: number }>();
const balances = new Map<string, number>(); // userId -> cents, loaded lazily
const open = new Map<string, Position>();
const openByAsset = new Map<Asset, Set<string>>();
const openByUser = new Map<string, Set<string>>();

const stats = { commands: 0, batches: 0, liquidations: 0, totalLagMs: 0 };

// ---------------------------------------------------------------- serial queue

let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn);
  chain = next.catch(() => {});
  return next;
}

// ---------------------------------------------------------------- state helpers

function track(p: Position) {
  open.set(p.id, p);
  (openByAsset.get(p.asset) ?? openByAsset.set(p.asset, new Set()).get(p.asset)!).add(p.id);
  (openByUser.get(p.userId) ?? openByUser.set(p.userId, new Set()).get(p.userId)!).add(p.id);
}
function untrack(p: Position) {
  open.delete(p.id);
  openByAsset.get(p.asset)?.delete(p.id);
  openByUser.get(p.userId)?.delete(p.id);
}

async function balanceOf(userId: string): Promise<number | null> {
  const cached = balances.get(userId);
  if (cached !== undefined) return cached;
  const { rows } = await db().query<{ balance_cents: string }>("select balance_cents from users where id = $1", [userId]);
  if (!rows[0]) return null;
  const b = Number(rows[0].balance_cents);
  balances.set(userId, b);
  return b;
}

function freshPrice(asset: Asset): number | null {
  const p = prices.get(asset);
  return p && Date.now() - p.at < MAX_PRICE_AGE_MS ? p.price : null;
}

const reject = (c: Command, reason: RejectReason): Result => ({ kind: "rejected", id: c.id, userId: c.userId, reason });
const dto = ({ userId: _u, closing: _c, ...p }: Position): PositionDTO => p;

// ---------------------------------------------------------------- batch (group commit)

type Closed = Required<Pick<PositionDTO, "closedAt" | "exitPrice" | "pnlCents" | "closeReason">>;

/** Everything one batch changes, written in a single statement by commit(). */
class Batch {
  balances = new Map<string, number>();
  inserts = new Map<string, Position & Partial<Closed>>();
  closes = new Map<string, Closed>();
  results: Result[] = [];

  setBalance(userId: string, cents: number) {
    balances.set(userId, cents);
    this.balances.set(userId, cents);
  }
  close(p: Position, c: Closed) {
    // Opened and closed in the same batch: insert it already closed (one snapshot, no update needed).
    const ins = this.inserts.get(p.id);
    if (ins) Object.assign(ins, c);
    else this.closes.set(p.id, c);
  }
  get empty() { return this.balances.size === 0 && this.inserts.size === 0 && this.closes.size === 0; }
}

async function commit(b: Batch) {
  if (b.empty) return;
  const bal = [...b.balances];
  const ins = [...b.inserts.values()];
  const cls = [...b.closes];
  await db().query(
    `with bal as (
       update users u set balance_cents = v.b from unnest($1::text[], $2::bigint[]) as v(id, b) where u.id = v.id returning 1
     ), ins as (
       insert into positions (id, user_id, asset, side, margin_cents, leverage, qty, entry_price, liquidation_price, opened_at, closed_at, exit_price, pnl_cents, close_reason)
       select id, user_id, asset, side, margin, lev, qty, entry, liq, to_timestamp(opened / 1000.0), to_timestamp(closed / 1000.0), exit_price, pnl, reason
       from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[], $8::int[], $9::float8[], $10::float8[], $11::float8[], $12::float8[], $13::float8[], $14::float8[], $15::bigint[], $16::text[])
         as t(id, user_id, asset, side, margin, lev, qty, entry, liq, opened, closed, exit_price, pnl, reason)
       on conflict (id) do nothing returning 1
     ), cls as (
       update positions p set closed_at = to_timestamp(v.closed / 1000.0), exit_price = v.exit_price, pnl_cents = v.pnl, close_reason = v.reason
       from unnest($17::text[], $18::float8[], $19::float8[], $20::bigint[], $21::text[]) as v(id, closed, exit_price, pnl, reason)
       where p.id = v.id and p.closed_at is null returning 1
     )
     select (select count(*) from bal) + (select count(*) from ins) + (select count(*) from cls) as n`,
    [
      bal.map(([id]) => id), bal.map(([, c]) => c),
      ins.map((p) => p.id), ins.map((p) => p.userId), ins.map((p) => p.asset), ins.map((p) => p.side), ins.map((p) => p.marginCents),
      ins.map((p) => p.leverage), ins.map((p) => p.qty), ins.map((p) => p.entryPrice), ins.map((p) => p.liquidationPrice), ins.map((p) => p.openedAt),
      ins.map((p) => p.closedAt ?? null), ins.map((p) => p.exitPrice ?? null), ins.map((p) => p.pnlCents ?? null), ins.map((p) => p.closeReason ?? null),
      cls.map(([id]) => id), cls.map(([, c]) => c.closedAt), cls.map(([, c]) => c.exitPrice), cls.map(([, c]) => c.pnlCents), cls.map(([, c]) => c.closeReason),
    ],
  );
}

/** Commit, then publish results and XACK in one pipeline. A failed commit leaves memory ahead of
 *  Postgres, so the engine exits and rebuilds; unacked commands are replayed on start. */
async function finish(b: Batch, ackIds: string[]) {
  try {
    await commit(b);
  } catch (e) {
    log("engine", "commit failed, restarting to rebuild state", (e as Error).message);
    process.exit(1);
  }
  const pipe = writer.pipeline();
  for (const r of b.results) pipe.xadd(STREAM.results, "MAXLEN", "~", 10_000, "*", ...encode(r));
  if (ackIds.length) pipe.xack(STREAM.commands, ENGINE_GROUP, ...ackIds);
  await pipe.exec();
}

// ---------------------------------------------------------------- command handlers

async function openPosition(b: Batch, c: Extract<Command, { kind: "open" }>, retry: boolean): Promise<Result> {
  if (retry) {
    const { rows } = await db().query<PositionRow>("select * from positions where id = $1", [c.id]);
    if (rows[0]) return { kind: "opened", id: c.id, userId: c.userId, position: rowToDTO(rows[0]) };
  }
  if (!isAsset(c.asset) || !(c.marginCents > 0) || !(c.leverage >= 1)) return reject(c, "invalid");
  const price = freshPrice(c.asset);
  if (price === null) return reject(c, "no_price");
  const balance = await balanceOf(c.userId);
  if (balance === null) return reject(c, "invalid");
  if (balance < c.marginCents) return reject(c, "insufficient_balance");

  const p: Position = {
    id: c.id, userId: c.userId, asset: c.asset, side: c.side, marginCents: c.marginCents, leverage: c.leverage,
    qty: ((c.marginCents / 100) * c.leverage) / price, entryPrice: price,
    liquidationPrice: liquidationPrice(c.side, price, c.leverage), openedAt: Date.now(),
  };
  b.setBalance(c.userId, balance - c.marginCents);
  b.inserts.set(p.id, p);
  track(p);
  return { kind: "opened", id: c.id, userId: c.userId, position: dto(p) };
}

async function settle(b: Batch, p: Position, price: number, reason: "user" | "liquidation"): Promise<PositionDTO> {
  const pnl = pnlCents(p, price);
  b.setBalance(p.userId, ((await balanceOf(p.userId)) ?? 0) + p.marginCents + pnl);
  const closed: Closed = { closedAt: Date.now(), exitPrice: price, pnlCents: pnl, closeReason: reason };
  b.close(p, closed);
  untrack(p);
  return { ...dto(p), ...closed };
}

async function closePosition(b: Batch, c: Extract<Command, { kind: "close" }>): Promise<Result> {
  if (b.closes.has(c.positionId) || b.inserts.get(c.positionId)?.closedAt) return reject(c, "already_closed");
  const p = open.get(c.positionId);
  if (!p || p.userId !== c.userId) {
    const { rows } = await db().query<PositionRow>("select * from positions where id = $1 and user_id = $2", [c.positionId, c.userId]);
    if (rows[0]?.closed_at) return { kind: "closed", id: c.id, userId: c.userId, position: rowToDTO(rows[0]) };
    return reject(c, "not_found");
  }
  if (p.closing) return reject(c, "already_closed");
  const price = freshPrice(p.asset);
  if (price === null) return reject(c, "no_price");
  return { kind: "closed", id: c.id, userId: c.userId, position: await settle(b, p, price, "user") };
}

async function resetAccount(b: Batch, c: Extract<Command, { kind: "reset" }>): Promise<Result> {
  if ((openByUser.get(c.userId)?.size ?? 0) > 0) return reject(c, "has_open_positions");
  if ((await balanceOf(c.userId)) === null) return reject(c, "invalid");
  b.setBalance(c.userId, STARTING_BALANCE_CENTS);
  return { kind: "reset", id: c.id, userId: c.userId, balanceCents: STARTING_BALANCE_CENTS };
}

function handle(b: Batch, c: Command, retry: boolean): Promise<Result> {
  switch (c.kind) {
    case "open": return openPosition(b, c, retry);
    case "close": return closePosition(b, c);
    case "reset": return resetAccount(b, c);
    default: return Promise.resolve(reject(c as Command, "invalid"));
  }
}

// ---------------------------------------------------------------- loops

type Entries = [string, string[]][];

async function commandLoop() {
  await commandReader.xgroup("CREATE", STREAM.commands, ENGINE_GROUP, "$", "MKSTREAM").catch((e: Error) => {
    if (!e.message.includes("BUSYGROUP")) throw e;
  });
  // Pass 1 replays unacknowledged commands (this consumer's and, via XAUTOCLAIM, earlier processes').
  let replaying = true;
  for (;;) {
    try {
      if (replaying) {
        const own = ((await commandReader.xreadgroup("GROUP", ENGINE_GROUP, CONSUMER, "COUNT", BATCH, "STREAMS", STREAM.commands, "0")) as [string, Entries][] | null)?.[0]?.[1] ?? [];
        const claimed = own.length ? [] : ((await commandReader.xautoclaim(STREAM.commands, ENGINE_GROUP, CONSUMER, 0, "0", "COUNT", BATCH)) as [string, Entries])[1];
        const entries = own.length ? own : claimed;
        if (entries.length) { await serial(() => processBatch(entries, true)); continue; }
        replaying = false;
        log("engine", "ready, reading new commands");
      }
      const res = (await commandReader.xreadgroup("GROUP", ENGINE_GROUP, CONSUMER, "COUNT", BATCH, "BLOCK", 5000, "STREAMS", STREAM.commands, ">")) as [string, Entries][] | null;
      const entries = res?.[0]?.[1] ?? [];
      if (entries.length) await serial(() => processBatch(entries, false));
    } catch (e) {
      log("engine", "command loop error", (e as Error).message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** One query for every balance the batch needs that is not cached yet. */
async function prefetchBalances(commands: Command[]) {
  const missing = [...new Set(commands.map((c) => c.userId))].filter((u) => !balances.has(u));
  if (!missing.length) return;
  const { rows } = await db().query<{ id: string; balance_cents: string }>("select id, balance_cents from users where id = any($1)", [missing]);
  for (const r of rows) balances.set(r.id, Number(r.balance_cents));
}

async function processBatch(entries: Entries, retry: boolean) {
  const b = new Batch();
  const commands = entries.map(([id, fields]) => [id, decode<Command>(fields)] as const);
  await prefetchBalances(commands.flatMap(([, c]) => (c ? [c] : [])));
  for (const [id, c] of commands) {
    if (!c) continue;
    b.results.push(await handle(b, c, retry));
    stats.totalLagMs += Date.now() - Number(id.split("-")[0]);
  }
  await finish(b, entries.map(([id]) => id));
  stats.commands += entries.length;
  stats.batches++;
}

function onTick(t: Tick) {
  prices.set(t.asset, { price: t.price, at: Date.now() });
  const ids = openByAsset.get(t.asset);
  if (!ids?.size) return;
  const hit: Position[] = [];
  for (const id of ids) {
    const p = open.get(id);
    if (!p || p.closing) continue;
    if (p.side === "long" ? t.price <= p.liquidationPrice : t.price >= p.liquidationPrice) { p.closing = true; hit.push(p); }
  }
  if (!hit.length) return;
  serial(async () => {
    const b = new Batch();
    for (const p of hit) {
      if (!open.has(p.id)) continue;
      b.results.push({ kind: "liquidated", id: `liq-${p.id}`, userId: p.userId, position: await settle(b, p, t.price, "liquidation") });
    }
    await finish(b, []);
    stats.liquidations += b.results.length;
  }).catch((e: Error) => log("engine", "liquidation failed", e.message));
}

async function priceLoop() {
  // Seed from the newest entries so a restart has prices before the next tick.
  const recent = (await priceReader.xrevrange(STREAM.prices, "+", "-", "COUNT", 50)) as Entries;
  for (const [, fields] of recent.reverse()) for (const t of decode<Tick[]>(fields) ?? []) prices.set(t.asset, { price: t.price, at: t.ts });
  let last = recent.length ? recent[recent.length - 1]![0] : "$";
  for (;;) {
    try {
      const res = (await priceReader.xread("COUNT", 100, "BLOCK", 5000, "STREAMS", STREAM.prices, last)) as [string, Entries][] | null;
      for (const [id, fields] of res?.[0]?.[1] ?? []) {
        last = id;
        for (const t of decode<Tick[]>(fields) ?? []) onTick(t);
      }
    } catch (e) {
      log("engine", "price loop error", (e as Error).message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function loadState() {
  const { rows } = await db().query<PositionRow & { balance_cents: string }>(
    "select p.*, u.balance_cents from positions p join users u on u.id = p.user_id where p.closed_at is null",
  );
  for (const r of rows) {
    balances.set(r.user_id, Number(r.balance_cents));
    track({ ...rowToDTO(r), userId: r.user_id });
  }
  log("engine", `loaded ${rows.length} open positions`);
}

/**
 * Only one engine may own state: two would each hold their own balances while the consumer group
 * split commands between them. The lock is renewed every 5 s; if another engine holds it, this one stops.
 */
const LOCK = "engine:leader";
async function becomeLeader() {
  for (let waited = 0; ; waited++) {
    if (await writer.set(LOCK, CONSUMER, "PX", 15_000, "NX")) break;
    if (waited % 15 === 0) log("engine", "another engine holds the lock, waiting");
    await new Promise((r) => setTimeout(r, 2000));
  }
  setInterval(async () => {
    // Renew, or re-take the lock if it lapsed during a pause (GC, laptop sleep) and nobody else took it.
    const held = await writer.eval(
      `local v = redis.call('get', KEYS[1])
       if v == ARGV[1] then return redis.call('pexpire', KEYS[1], 15000) end
       if not v then redis.call('set', KEYS[1], ARGV[1], 'PX', 15000) return 1 end
       return 0`, 1, LOCK, CONSUMER,
    ).catch(() => -1);
    if (held === 0) { log("engine", "another engine took the leader lock, exiting"); process.exit(1); }
  }, 5000).unref();
}

async function main() {
  await becomeLeader();
  await migrate();
  await loadState();
  void priceLoop();
  void commandLoop();
  setInterval(() => {
    if (!stats.commands && !stats.liquidations) return;
    log("engine", `last 60s: ${stats.commands} commands in ${stats.batches} batches, avg queue-to-commit ${(stats.totalLagMs / Math.max(1, stats.commands)).toFixed(1)} ms, ${stats.liquidations} liquidations, ${open.size} open`);
    stats.commands = stats.batches = stats.liquidations = stats.totalLagMs = 0;
  }, 60_000);
}

main().catch((e) => { log("engine", "fatal", e); process.exit(1); });
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await chain.catch(() => {});
    await writer.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, LOCK, CONSUMER).catch(() => {});
    writer.disconnect(); priceReader.disconnect(); commandReader.disconnect(); process.exit(0); });
}
