/**
 * Candles from Binance's public market data API (the same venue the poller streams from), cached briefly and
 * deduplicated so a burst of chart loads costs one upstream request.
 */
import { ASSETS, type Asset } from "@strata/shared";

export const INTERVALS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400 } as const;
type Interval = keyof typeof INTERVALS;
/** [time (unix seconds), open, high, low, close, volume] */
export type Candle = [number, number, number, number, number, number];

const CANDLES = 300;
const TTL_MS = 10_000;
const cache = new Map<string, { at: number; data: Promise<Candle[]> }>();

export function klines(asset: Asset, interval: Interval): Promise<Candle[]> {
  const key = `${asset}:${interval}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = fetchCandles(asset, interval);
  cache.set(key, { at: Date.now(), data });
  data.catch(() => cache.delete(key));
  return data;
}

async function fetchCandles(asset: Asset, interval: Interval): Promise<Candle[]> {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${ASSETS[asset].symbol}&interval=${interval}&limit=${CANDLES}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`binance ${res.status}`);
  // [openTime ms, open, high, low, close, base volume, closeTime, quote volume, ...]
  const rows = (await res.json()) as [number, string, string, string, string, string, number, string][];
  return rows.map((k) => [k[0] / 1000, Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[7])]);
}
