"use client";
import Link from "next/link";
import { pct, price, compact } from "../lib/format";
import { useTick, useTicks } from "../lib/live";
import { ASSETS } from "../lib/types";
import styles from "../app/page.module.css";

export function LiveMarkets() {
  const ticks = useTicks();
  return (
    <ul className={styles.markets}>
      {ASSETS.map(({ asset, name }) => {
        const t = ticks[asset];
        const change = t ? (t.price - t.open24h) / t.open24h : NaN;
        return (
          <li key={asset}>
            <Link href={`/trade?asset=${asset}`} className={styles.market}>
              <span className={styles.marketName}><span className="serif">{name}</span><span className="label">{asset}/USDC</span></span>
              <span className={`num ${styles.marketPrice}`}>{t ? `$${price(t.price)}` : "—"}</span>
              <span className={`num ${change >= 0 ? "up" : "down"}`}>{pct(change)}</span>
              <span className={`num muted ${styles.marketRange}`}>{t ? `${price(t.low24h)} – ${price(t.high24h)}` : ""}</span>
              <span className={`num muted ${styles.marketVol}`}>{t ? `$${compact(t.volume24h)} vol` : ""}</span>
              <span className={styles.marketGo} aria-hidden="true">→</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Big live BTC price for the hero. */
export function HeroTicker() {
  const t = useTick("BTC");
  const change = t ? (t.price - t.open24h) / t.open24h : NaN;
  return (
    <Link href="/trade?asset=BTC" className={styles.ticker} aria-label="Bitcoin live price, open in terminal">
      <span className="label">BTC / USDC · live</span>
      <span className={styles.tickerPrice}>{t ? `$${price(t.price)}` : "—"}</span>
      <span className={styles.tickerMeta}>
        <span className={`num ${change >= 0 ? "up" : "down"}`}>{pct(change)}</span>
        <span className="label">24h</span>
      </span>
    </Link>
  );
}
