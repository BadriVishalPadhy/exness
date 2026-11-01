/**
 * Poller: streams Binance's public market data (every trade, a 24h summary each second and the top
 * 20 levels of the book) and publishes the latest price per market to the "prices" Redis stream every
 * 100 ms when something changed, and every market at least every 5 s. Books go out on a pub/sub
 * channel at most every 250 ms per market.
 */
import WebSocket from "ws";
import { ASSETS, BOOK_CHANNEL, STREAM, encode, log, redisClient, type Asset, type Book, type Tick } from "@strata/shared";

const FLUSH_MS = 100;
const BOOK_MS = 250;
const STALE_MS = 15_000; // reconnect if the feed goes quiet this long
const HEARTBEAT_MS = 5_000; // re-send unchanged markets so consumers can tell quiet from stale
const redis = redisClient("poller");
const bySymbol = new Map<string, Asset>(Object.entries(ASSETS).map(([a, c]) => [c.symbol, a as Asset]));
const BOOK_SUFFIX = "@depth20@100ms";
const STREAMS = Object.values(ASSETS).flatMap(({ symbol }) => {
  const s = symbol.toLowerCase();
  return [`${s}@aggTrade`, `${s}@miniTicker`, `${s}${BOOK_SUFFIX}`];
});
const FEED = `wss://data-stream.binance.vision/stream?streams=${STREAMS.join("/")}`;

const latest = new Map<Asset, Tick>();
const dirty = new Set<Asset>();
const publishedAt = new Map<Asset, number>();
const books = new Map<Asset, Book>();
const dirtyBooks = new Set<Asset>();
const levels = (rows: unknown) => (rows as [string, string][]).map(([p, q]) => [Number(p), Number(q)] as [number, number]);
let lastMessageAt = Date.now();
let attempt = 0;

/** Trades move the price; the 24h summary fills in open, high, low and volume. */
function apply(asset: Asset, d: Record<string, string | number>, kind: "trade" | "summary") {
  const price = Number(kind === "trade" ? d.p : d.c);
  if (!Number.isFinite(price) || price <= 0) return;
  const prev = latest.get(asset);
  const next: Tick = kind === "summary"
    ? { asset, price, open24h: Number(d.o), high24h: Number(d.h), low24h: Number(d.l), volume24h: Number(d.q), ts: Number(d.E) || Date.now() }
    : prev
      ? { ...prev, price, high24h: Math.max(prev.high24h, price), low24h: Math.min(prev.low24h, price), ts: Number(d.T) || Date.now() }
      : { asset, price, open24h: price, high24h: price, low24h: price, volume24h: 0, ts: Number(d.T) || Date.now() };
  if (prev && prev.price === next.price && prev.open24h === next.open24h && prev.volume24h === next.volume24h) return;
  latest.set(asset, next);
  dirty.add(asset);
}

function connect() {
  const ws = new WebSocket(FEED);
  let watchdog: NodeJS.Timeout | undefined;

  ws.on("open", () => {
    attempt = 0;
    lastMessageAt = Date.now();
    log("poller", "connected to Binance");
    watchdog = setInterval(() => {
      if (Date.now() - lastMessageAt > STALE_MS) { log("poller", "feed stale, reconnecting"); ws.terminate(); }
    }, 5_000);
  });

  ws.on("message", (raw) => {
    lastMessageAt = Date.now();
    let msg: { stream?: string; data?: Record<string, string | number> };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const d = msg.data;
    if (!d) return;
    if (msg.stream?.endsWith(BOOK_SUFFIX)) {
      // Partial-depth messages carry no symbol; the stream name says which market it is.
      const asset = bySymbol.get(msg.stream.slice(0, -BOOK_SUFFIX.length).toUpperCase());
      if (asset) { books.set(asset, { asset, bids: levels(d.bids), asks: levels(d.asks), ts: Date.now() }); dirtyBooks.add(asset); }
      return;
    }
    const asset = bySymbol.get(String(d.s));
    if (!asset) return;
    if (d.e === "aggTrade") apply(asset, d, "trade");
    else if (d.e === "24hrMiniTicker") apply(asset, d, "summary");
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

function flushBooks() {
  for (const asset of dirtyBooks) {
    redis.publish(BOOK_CHANNEL, JSON.stringify(books.get(asset))).catch((e) => log("poller", "book publish failed", (e as Error).message));
  }
  dirtyBooks.clear();
}

setInterval(flush, FLUSH_MS);
setInterval(flushBooks, BOOK_MS);
connect();

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { redis.disconnect(); process.exit(0); });
