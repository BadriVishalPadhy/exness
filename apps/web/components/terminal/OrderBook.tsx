"use client";
import { useRef } from "react";
import { useBook, useTick } from "../../lib/live";
import type { Asset } from "../../lib/types";
import styles from "./terminal.module.css";

const LEVELS = 20;
/** Binance's size step per market, so sizes line up in the column. */
const SIZE_DIGITS: Record<Asset, number> = { BTC: 5, ETH: 4, SOL: 3 };

const fmt = (n: number, digits: number) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Running total from the best price outward, which is what the depth bars show. */
function withTotals(levels: [number, number][]) {
  let total = 0;
  return levels.slice(0, LEVELS).map(([price, size]) => ({ price, size, total: (total += size) }));
}

export function OrderBook({ asset }: { asset: Asset }) {
  const book = useBook(asset);
  const tick = useTick(asset);
  const lastPrice = useRef<{ asset: Asset; price: number; dir: "up" | "down" } | null>(null);

  if (tick) {
    const prev = lastPrice.current;
    const dir = prev && prev.asset === asset && tick.price !== prev.price ? (tick.price > prev.price ? "up" : "down") : prev?.asset === asset ? prev.dir : "up";
    lastPrice.current = { asset, price: tick.price, dir };
  }

  const asks = withTotals(book?.asks ?? []);
  const bids = withTotals(book?.bids ?? []);
  const max = Math.max(asks.at(-1)?.total ?? 0, bids.at(-1)?.total ?? 0) || 1;
  const digits = SIZE_DIGITS[asset];
  const bestAsk = asks[0]?.price, bestBid = bids[0]?.price;
  const spread = bestAsk !== undefined && bestBid !== undefined ? bestAsk - bestBid : undefined;

  const row = (side: "ask" | "bid") => (l: { price: number; size: number; total: number }) => (
    <div key={l.price} className={styles.bookRow} data-side={side} style={{ "--depth": `${(l.total / max) * 100}%` } as React.CSSProperties}>
      <span>{fmt(l.price, 2)}</span>
      <span>{fmt(l.size, digits)}</span>
      <span>{fmt(l.total, digits)}</span>
    </div>
  );

  return (
    <section className={styles.book} aria-label={`${asset} order book`}>
      <div className={styles.bookHead}>
        <span>Price (USDT)</span><span>Size ({asset})</span><span>Total ({asset})</span>
      </div>
      {!book ? (
        <p className={`label ${styles.bookEmpty}`}>Loading the book…</p>
      ) : (
        <>
          {/* Asks read upward from the spread, so the best ask sits just above the middle. */}
          <div className={styles.asks}>{[...asks].reverse().map(row("ask"))}</div>
          <div className={styles.spread}>
            <b className={`num ${lastPrice.current?.dir ?? ""}`}>{tick ? `$${fmt(tick.price, 2)}` : "—"}</b>
            <span className="label">Spread {spread !== undefined ? fmt(spread, 2) : "—"}</span>
          </div>
          <div className={styles.bids}>{bids.map(row("bid"))}</div>
        </>
      )}
    </section>
  );
}
