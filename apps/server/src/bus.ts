/**
 * The server's side of the Redis streams: sends commands to the engine and waits for their results,
 * keeps the latest tick per market for REST and WebSocket clients, and relays order books.
 */
import { BOOK_CHANNEL, STREAM, decode, encode, isAsset, log, redisClient, type Asset, type Book, type Command, type Result, type Tick } from "@strata/shared";

const writer = redisClient("server");
const resultReader = redisClient("server-results");
const priceReader = redisClient("server-prices");
const bookReader = redisClient("server-books");

export const latestTicks = new Map<Asset, Tick>();
export const latestBooks = new Map<Asset, Book>();

type Waiter = { resolve: (r: Result) => void; timer: NodeJS.Timeout };
const waiters = new Map<string, Waiter>();
const resultListeners = new Set<(r: Result) => void>();
const tickListeners = new Set<(t: Tick[]) => void>();
const bookListeners = new Set<(b: Book) => void>();

export const onResult = (fn: (r: Result) => void) => resultListeners.add(fn);
export const onTicks = (fn: (t: Tick[]) => void) => tickListeners.add(fn);
export const onBook = (fn: (b: Book) => void) => bookListeners.add(fn);

/** Registers the waiter before publishing, so even an instant result cannot be missed. */
export function send(c: Command, timeoutMs = 5000): Promise<Result | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(c.id); resolve(null); }, timeoutMs);
    waiters.set(c.id, { resolve, timer });
    writer.xadd(STREAM.commands, "MAXLEN", "~", 10_000, "*", ...encode(c)).catch((e) => {
      clearTimeout(timer);
      waiters.delete(c.id);
      reject(e);
    });
  });
}

async function resultLoop() {
  let last = "$";
  for (;;) {
    try {
      const res = (await resultReader.xread("COUNT", 100, "BLOCK", 5000, "STREAMS", STREAM.results, last)) as [string, [string, string[]][]][] | null;
      for (const [id, fields] of res?.[0]?.[1] ?? []) {
        last = id;
        const r = decode<Result>(fields);
        if (!r) continue;
        const w = waiters.get(r.id);
        if (w) { clearTimeout(w.timer); waiters.delete(r.id); w.resolve(r); }
        for (const fn of resultListeners) fn(r);
      }
    } catch (e) {
      log("server", "result loop error", (e as Error).message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function priceLoop() {
  const recent = (await priceReader.xrevrange(STREAM.prices, "+", "-", "COUNT", 50)) as [string, string[]][];
  for (const [, fields] of recent.reverse()) for (const t of decode<Tick[]>(fields) ?? []) latestTicks.set(t.asset, t);
  let last = recent.length ? recent[recent.length - 1]![0] : "$";
  for (;;) {
    try {
      const res = (await priceReader.xread("COUNT", 100, "BLOCK", 5000, "STREAMS", STREAM.prices, last)) as [string, [string, string[]][]][] | null;
      const batch: Tick[] = [];
      for (const [id, fields] of res?.[0]?.[1] ?? []) {
        last = id;
        for (const t of decode<Tick[]>(fields) ?? []) { latestTicks.set(t.asset, t); batch.push(t); }
      }
      if (batch.length) for (const fn of tickListeners) fn(batch);
    } catch (e) {
      log("server", "price loop error", (e as Error).message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

function relayBooks() {
  bookReader.on("message", (_channel: string, raw: string) => {
    let b: Book;
    try { b = JSON.parse(raw); } catch { return; }
    if (!isAsset(b?.asset)) return;
    latestBooks.set(b.asset, b);
    for (const fn of bookListeners) fn(b);
  });
  void bookReader.subscribe(BOOK_CHANNEL).catch((e) => log("server", "book subscribe failed", (e as Error).message));
}

export function startBus() {
  void resultLoop();
  void priceLoop();
  relayBooks();
}

export const redisPing = () => writer.ping();
