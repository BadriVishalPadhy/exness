"use client";
import { useState } from "react";
import { api, explain } from "../../lib/api";
import { money, price, signedMoney } from "../../lib/format";
import { useTicks } from "../../lib/live";
import { unrealizedCents, type Position } from "../../lib/types";
import styles from "./terminal.module.css";

export function Positions({ positions, history, onDone }: {
  positions: Position[]; history: Position[]; onDone: (msg: string, tone: "up" | "down" | "blue") => void;
}) {
  const [tab, setTab] = useState<"open" | "history">("open");
  const [closing, setClosing] = useState<string | null>(null);
  const ticks = useTicks();

  async function close(p: Position) {
    setClosing(p.id);
    try {
      const r = await api.close(p.id);
      const pnl = r.position.pnlCents ?? 0;
      onDone(`Closed ${p.asset} ${p.side} · ${signedMoney(pnl)} · ${r.ms} ms`, pnl >= 0 ? "up" : "down");
    } catch (e) {
      onDone(explain(e), "down");
    } finally {
      setClosing(null);
    }
  }

  return (
    <section className={styles.positions} aria-label="Positions">
      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={tab === "open"} onClick={() => setTab("open")}>Positions <span className="num">{positions.length}</span></button>
        <button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>History <span className="num">{history.length}</span></button>
      </div>
      <div className={styles.tableWrap}>
        {tab === "open" ? (
          positions.length === 0 ? <p className={styles.empty}>No open positions. Pick a side on the right.</p> : (
            <table className={styles.table}>
              <thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>Liq.</th><th>PnL</th><th /></tr></thead>
              <tbody>
                {positions.map((p) => {
                  const mark = ticks[p.asset]?.price;
                  const pnl = mark ? unrealizedCents(p, mark) : 0;
                  return (
                    <tr key={p.id}>
                      <td>{p.asset}/USDC</td>
                      <td className={p.side === "long" ? "up" : "down"}>{p.side} {p.leverage}×</td>
                      <td className="num">{money(p.marginCents * p.leverage)}</td>
                      <td className="num">{price(p.entryPrice)}</td>
                      <td className="num">{price(mark)}</td>
                      <td className="num muted">{price(p.liquidationPrice)}</td>
                      <td className={`num ${pnl >= 0 ? "up" : "down"}`}>{signedMoney(pnl)} <span className="muted">({((pnl / p.marginCents) * 100).toFixed(1)}%)</span></td>
                      <td><button className="btn btn-sm" onClick={() => close(p)} disabled={closing === p.id}>{closing === p.id ? "…" : "Close"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : history.length === 0 ? <p className={styles.empty}>Closed positions show up here.</p> : (
          <table className={styles.table}>
            <thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Exit</th><th>PnL</th><th>Closed</th></tr></thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id}>
                  <td>{p.asset}/USDC</td>
                  <td className={p.side === "long" ? "up" : "down"}>{p.side} {p.leverage}×</td>
                  <td className="num">{money(p.marginCents * p.leverage)}</td>
                  <td className="num">{price(p.entryPrice)}</td>
                  <td className="num">{price(p.exitPrice)}</td>
                  <td className={`num ${(p.pnlCents ?? 0) >= 0 ? "up" : "down"}`}>{signedMoney(p.pnlCents ?? 0)}</td>
                  <td className="muted">{p.closeReason === "liquidation" ? "Liquidated" : new Date(p.closedAt ?? 0).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
