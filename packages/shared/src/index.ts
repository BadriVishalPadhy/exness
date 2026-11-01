/**
 * Shared by the poller, engine and API server: configuration, Redis stream names and message shapes,
 * money helpers, and the Postgres pool with its schema.
 */
import Redis from "ioredis";
import { Pool } from "pg";

// ---------------------------------------------------------------- config

export const config = {
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  databaseUrl: process.env.DATABASE_URL ?? "",
};

export function redisClient(name: string): Redis {
  const r = new Redis(config.redisUrl, { maxRetriesPerRequest: null, connectionName: name });
  r.on("error", (e) => log(name, "redis error", e.message));
  return r;
}

export function log(service: string, ...args: unknown[]) {
  console.log(new Date().toISOString(), `[${service}]`, ...args);
}

// ---------------------------------------------------------------- markets

export const ASSETS = {
  BTC: { symbol: "BTCUSDT", name: "Bitcoin" },
  ETH: { symbol: "ETHUSDT", name: "Ethereum" },
  SOL: { symbol: "SOLUSDT", name: "Solana" },
} as const;
export type Asset = keyof typeof ASSETS;
export const isAsset = (a: unknown): a is Asset => typeof a === "string" && a in ASSETS;

export const MAX_LEVERAGE = 100;
/** A position is liquidated once its loss reaches this share of the margin. */
export const LIQUIDATION_LOSS = 0.95;
export const STARTING_BALANCE_CENTS = 1_000_000; // $10,000 of demo USDT

// ---------------------------------------------------------------- streams
//
// prices   poller -> engine, server   one entry per 100 ms flush, trimmed to ~1000 entries
// commands server -> engine           consumer group "engine"; acked after the result is durable
// results  engine -> server           one entry per processed command or liquidation, trimmed

export const STREAM = { prices: "prices", commands: "commands", results: "results" } as const;
export const ENGINE_GROUP = "engine";

export interface Tick { asset: Asset; price: number; open24h: number; high24h: number; low24h: number; volume24h: number; ts: number }

export type Command =
  | { kind: "open"; id: string; userId: string; asset: Asset; side: "long" | "short"; marginCents: number; leverage: number }
  | { kind: "close"; id: string; userId: string; positionId: string }
  | { kind: "reset"; id: string; userId: string };

export type Result =
  | { kind: "opened"; id: string; userId: string; position: PositionDTO }
  | { kind: "closed"; id: string; userId: string; position: PositionDTO }
  | { kind: "liquidated"; id: string; userId: string; position: PositionDTO }
  | { kind: "reset"; id: string; userId: string; balanceCents: number }
  | { kind: "rejected"; id: string; userId: string; reason: RejectReason };

export type RejectReason = "no_price" | "insufficient_balance" | "not_found" | "already_closed" | "has_open_positions" | "invalid";

export interface PositionDTO {
  id: string; asset: Asset; side: "long" | "short"; marginCents: number; leverage: number;
  qty: number; entryPrice: number; liquidationPrice: number; openedAt: number;
  exitPrice?: number; pnlCents?: number; closedAt?: number; closeReason?: "user" | "liquidation";
}

/** Redis stream entries are flat [field, value, ...]; every message here is one JSON "m" field. */
export const encode = (msg: unknown) => ["m", JSON.stringify(msg)];
export function decode<T>(fields: string[]): T | null {
  const i = fields.indexOf("m");
  if (i < 0 || i + 1 >= fields.length) return null;
  try { return JSON.parse(fields[i + 1]!) as T; } catch { return null; }
}

// ---------------------------------------------------------------- money

export function liquidationPrice(side: "long" | "short", entry: number, leverage: number): number {
  const move = (entry * LIQUIDATION_LOSS) / leverage;
  return side === "long" ? entry - move : entry + move;
}

/** Profit in cents for a position marked at `price`, never below losing the whole margin. */
export function pnlCents(p: { side: "long" | "short"; qty: number; entryPrice: number; marginCents: number }, price: number): number {
  const raw = (p.side === "long" ? price - p.entryPrice : p.entryPrice - price) * p.qty * 100;
  return Math.max(-p.marginCents, Math.round(raw));
}

// ---------------------------------------------------------------- postgres

let pool: Pool | null = null;
export function db(): Pool {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
  pool ??= new Pool({ connectionString: config.databaseUrl, max: 5, idleTimeoutMillis: 30_000 });
  return pool;
}

const SCHEMA = `
create table if not exists users (
  id text primary key,
  balance_cents bigint not null,
  created_at timestamptz not null default now()
);
create table if not exists positions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  asset text not null,
  side text not null check (side in ('long', 'short')),
  margin_cents bigint not null,
  leverage int not null,
  qty double precision not null,
  entry_price double precision not null,
  liquidation_price double precision not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  exit_price double precision,
  pnl_cents bigint,
  close_reason text
);
create index if not exists positions_open_by_user on positions (user_id) where closed_at is null;
create index if not exists positions_closed_by_user on positions (user_id, closed_at desc) where closed_at is not null;
`;

/**
 * Idempotent. A transaction-scoped advisory lock keeps the engine and server from running it at the
 * same moment; it also holds behind a transaction-mode pooler (PgBouncer), where a session lock would not.
 */
export async function migrate() {
  await db().query(`begin; select pg_advisory_xact_lock(424242); ${SCHEMA} commit;`);
}

export interface PositionRow {
  id: string; user_id: string; asset: Asset; side: "long" | "short"; margin_cents: string; leverage: number;
  qty: number; entry_price: number; liquidation_price: number; opened_at: Date;
  closed_at: Date | null; exit_price: number | null; pnl_cents: string | null; close_reason: "user" | "liquidation" | null;
}

export function rowToDTO(r: PositionRow): PositionDTO {
  return {
    id: r.id, asset: r.asset, side: r.side, marginCents: Number(r.margin_cents), leverage: r.leverage,
    qty: r.qty, entryPrice: r.entry_price, liquidationPrice: r.liquidation_price, openedAt: r.opened_at.getTime(),
    ...(r.closed_at ? { closedAt: r.closed_at.getTime(), exitPrice: r.exit_price ?? undefined, pnlCents: Number(r.pnl_cents), closeReason: r.close_reason ?? undefined } : {}),
  };
}
