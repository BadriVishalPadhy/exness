"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ensureToken, explain } from "../../lib/api";
import { money, pct, price, compact, signedMoney } from "../../lib/format";
import { onAccountEvent, reconnectWithToken, useTicks } from "../../lib/live";
import { ASSETS, unrealizedCents, type Account, type Asset } from "../../lib/types";
import { LiveStatus, Mark } from "../Nav";
import { Chart } from "./Chart";
import { OrderBook } from "./OrderBook";
import { OrderPanel } from "./OrderPanel";
import { Positions } from "./Positions";
import styles from "./terminal.module.css";

type Toast = { msg: string; tone: "up" | "down" | "blue"; key: number };

export function Terminal({ initialAsset }: { initialAsset: Asset }) {
  const [asset, setAsset] = useState<Asset>(initialAsset);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const ticks = useTicks();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(() => api.me().then((a) => { setAccount(a); setError(null); reconnectWithToken(); }).catch((e) => setError(explain(e))), []);
  const notify = useCallback((msg: string, tone: Toast["tone"]) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, tone, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => {
    ensureToken().then(() => { reconnectWithToken(); return refresh(); }).catch((e) => setError(explain(e)));
    return onAccountEvent((e) => {
      void refresh();
      if (e.event === "liquidated" && e.position) notify(`${e.position.asset} ${e.position.side} ${e.position.leverage}× was liquidated.`, "down");
    });
  }, [refresh, notify]);

  // Keep the selected market in the URL without a navigation.
  useEffect(() => { history.replaceState(null, "", `/trade?asset=${asset}`); }, [asset]);

  const equity = useMemo(() => {
    if (!account) return 0;
    return account.balanceCents + account.positions.reduce((s, p) => {
      const mark = ticks[p.asset]?.price;
      return s + p.marginCents + (mark ? unrealizedCents(p, mark) : 0);
    }, 0);
  }, [account, ticks]);
  const openPnl = account ? equity - account.balanceCents - account.positions.reduce((s, p) => s + p.marginCents, 0) : 0;

  async function reset() {
    try { await api.reset(); notify("Balance reset to $10,000.", "blue"); void refresh(); }
    catch (e) { notify(explain(e), "down"); }
  }

  const t = ticks[asset];
  const change = t ? (t.price - t.open24h) / t.open24h : NaN;
  const done = (msg: string, tone: Toast["tone"]) => { notify(msg, tone); void refresh(); };

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand} aria-label="Strata home"><Mark size={20} /><span>Strata</span></Link>
        <nav className={styles.marketList} aria-label="Markets">
          {ASSETS.map(({ asset: a }) => {
            const tk = ticks[a];
            const ch = tk ? (tk.price - tk.open24h) / tk.open24h : NaN;
            return (
              <button key={a} type="button" aria-pressed={a === asset} onClick={() => setAsset(a)} className={styles.marketBtn}>
                <b>{a}</b>
                <span className="num">{price(tk?.price)}</span>
                <span className={`num ${ch >= 0 ? "up" : "down"}`}>{pct(ch)}</span>
              </button>
            );
          })}
        </nav>
        <div className={styles.account}>
          <span><span className="label">Equity</span><b className="num">{account ? money(equity) : "—"}</b></span>
          <span><span className="label">Available</span><b className="num">{account ? money(account.balanceCents) : "—"}</b></span>
          <span><span className="label">Open PnL</span><b className={`num ${openPnl >= 0 ? "up" : "down"}`}>{account ? signedMoney(openPnl) : "—"}</b></span>
          {account && account.positions.length === 0 && account.balanceCents !== 1_000_000 && (
            <button className="btn btn-sm btn-ghost" onClick={reset}>Reset to $10k</button>
          )}
          <LiveStatus />
        </div>
      </header>

      <section className={styles.main}>
        <div className={styles.headline}>
          <h1 className="serif">{ASSETS.find((x) => x.asset === asset)?.name}<span className="label"> {asset}/USDT · perpetual</span></h1>
          <div className={styles.stats}>
            <span className={`num ${styles.bigPrice}`}>{t ? `$${price(t.price)}` : "—"}</span>
            <span><span className="label">24h</span><b className={`num ${change >= 0 ? "up" : "down"}`}>{pct(change)}</b></span>
            <span><span className="label">High</span><b className="num">{price(t?.high24h)}</b></span>
            <span><span className="label">Low</span><b className="num">{price(t?.low24h)}</b></span>
            <span><span className="label">Volume</span><b className="num">{t ? `$${compact(t.volume24h)}` : "—"}</b></span>
          </div>
        </div>
        <Chart asset={asset} positions={account?.positions ?? []} />
      </section>

      <div className={styles.bookArea}>
        <OrderBook asset={asset} />
      </div>

      <aside className={styles.side}>
        {error && <p className={`label down ${styles.err}`}>{error}</p>}
        <OrderPanel asset={asset} availableCents={account ? account.balanceCents : null} onDone={done} />
        <p className={styles.disclaimer}>Play money. Each new browser gets $10,000 of demo USDT. Liquidation at 95% loss of margin.</p>
      </aside>

      <div className={styles.bottom}>
        <Positions positions={account?.positions ?? []} history={account?.history ?? []} onDone={done} />
      </div>

      {toast && <div key={toast.key} className="toast" data-tone={toast.tone} role="status">{toast.msg}</div>}
    </div>
  );
}
