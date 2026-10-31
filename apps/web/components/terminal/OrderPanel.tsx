"use client";
import { useState } from "react";
import { api, explain } from "../../lib/api";
import { money, price, qty } from "../../lib/format";
import { useTick } from "../../lib/live";
import { MAX_LEVERAGE, liquidationPrice, type Asset } from "../../lib/types";
import styles from "./terminal.module.css";

const LEVERAGE_STEPS = [1, 5, 10, 25, 50, 100];

export function OrderPanel({ asset, availableCents, onDone }: {
  asset: Asset; availableCents: number; onDone: (msg: string, tone: "up" | "down" | "blue") => void;
}) {
  const [side, setSide] = useState<"long" | "short">("long");
  const [margin, setMargin] = useState("100");
  const [leverage, setLeverage] = useState(10);
  const [busy, setBusy] = useState(false);
  const tick = useTick(asset);

  const m = Number(margin);
  const valid = Number.isFinite(m) && m > 0 && m * 100 <= availableCents && !!tick;
  const size = m * leverage;
  const liq = tick ? liquidationPrice(side, tick.price, leverage) : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const r = await api.open({ asset, side, margin: Math.round(m * 100) / 100, leverage });
      onDone(`${side === "long" ? "Long" : "Short"} ${qty(r.position.qty)} ${asset} at $${price(r.position.entryPrice)} · filled in ${r.ms} ms`, side === "long" ? "up" : "down");
    } catch (err) {
      onDone(explain(err), "down");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.order} onSubmit={submit}>
      <div className={styles.sides} role="group" aria-label="Side">
        <button type="button" aria-pressed={side === "long"} data-side="long" onClick={() => setSide("long")}>Long</button>
        <button type="button" aria-pressed={side === "short"} data-side="short" onClick={() => setSide("short")}>Short</button>
      </div>

      <label className={styles.field}>
        <span className="label">Margin</span>
        <span className={styles.inputWrap}>
          <span className="muted">$</span>
          <input inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value.replace(/[^0-9.]/g, ""))} aria-describedby="avail" />
          <span className="label">USDC</span>
        </span>
      </label>
      <div className={styles.quick}>
        {[0.1, 0.25, 0.5, 1].map((f) => (
          <button key={f} type="button" onClick={() => setMargin(String(Math.floor((availableCents * f) / 100 * 100) / 100))}>{f === 1 ? "Max" : `${f * 100}%`}</button>
        ))}
      </div>
      <p id="avail" className={`label ${styles.avail}`}>Available <span className="num">{money(availableCents)}</span></p>

      <div className={styles.field}>
        <span className={styles.levHead}><span className="label">Leverage</span><span className="num">{leverage}×</span></span>
        <input type="range" min={1} max={MAX_LEVERAGE} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} aria-label="Leverage" className={styles.range} />
        <div className={styles.quick}>
          {LEVERAGE_STEPS.map((l) => (
            <button key={l} type="button" aria-pressed={l === leverage} onClick={() => setLeverage(l)}>{l}×</button>
          ))}
        </div>
      </div>

      <dl className={styles.summary}>
        <div><dt>Position size</dt><dd className="num">{Number.isFinite(size) ? money(size * 100) : "—"}</dd></div>
        <div><dt>Quantity</dt><dd className="num">{tick && size > 0 ? `${qty(size / tick.price)} ${asset}` : "—"}</dd></div>
        <div><dt>Entry ≈</dt><dd className="num">{tick ? `$${price(tick.price)}` : "—"}</dd></div>
        <div><dt>Liquidation ≈</dt><dd className="num down">{liq ? `$${price(liq)}` : "—"}</dd></div>
      </dl>

      <button type="submit" className={styles.submit} data-side={side} disabled={!valid || busy}>
        {busy ? "Sending…" : `${side === "long" ? "Long" : "Short"} ${asset} · ${leverage}×`}
      </button>
      {!tick && <p className="label">Waiting for a live price…</p>}
      {Number.isFinite(m) && m * 100 > availableCents && <p className="label down">More than your available balance.</p>}
    </form>
  );
}
