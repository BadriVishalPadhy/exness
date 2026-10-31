// Mirrors the API's shapes (packages/shared). Kept here so the web build has no server dependencies.
export type Asset = "BTC" | "ETH" | "SOL";
export const ASSETS: { asset: Asset; name: string }[] = [
  { asset: "BTC", name: "Bitcoin" },
  { asset: "ETH", name: "Ethereum" },
  { asset: "SOL", name: "Solana" },
];
export const MAX_LEVERAGE = 100;
export const LIQUIDATION_LOSS = 0.95;

export interface Tick { asset: Asset; price: number; open24h: number; high24h: number; low24h: number; volume24h: number; ts: number }

export interface Position {
  id: string; asset: Asset; side: "long" | "short"; marginCents: number; leverage: number;
  qty: number; entryPrice: number; liquidationPrice: number; openedAt: number;
  exitPrice?: number; pnlCents?: number; closedAt?: number; closeReason?: "user" | "liquidation";
}

export interface Account { userId: string; balanceCents: number; positions: Position[]; history: Position[] }

/** [time (unix seconds), open, high, low, close, volume] */
export type Candle = [number, number, number, number, number, number];
export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Interval = (typeof INTERVALS)[number];

export function unrealizedCents(p: Position, price: number): number {
  const raw = (p.side === "long" ? price - p.entryPrice : p.entryPrice - price) * p.qty * 100;
  return Math.max(-p.marginCents, Math.round(raw));
}
export function liquidationPrice(side: "long" | "short", entry: number, leverage: number): number {
  const move = (entry * LIQUIDATION_LOSS) / leverage;
  return side === "long" ? entry - move : entry + move;
}
