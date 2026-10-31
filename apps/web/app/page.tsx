import Link from "next/link";
import { AsciiChart } from "../components/AsciiChart";
import { LiveMarkets } from "../components/LiveMarkets";
import { Nav } from "../components/Nav";
import styles from "./page.module.css";

const STEPS = [
  { n: "01", title: "Poller", text: "Holds one WebSocket to Backpack, reconnects on its own, and publishes BTC, ETH and SOL to a Redis stream at most ten times a second." },
  { n: "02", title: "Redis Streams", text: "Prices, commands and results each get their own trimmed stream. Orders go through a consumer group, so nothing is lost if a process dies." },
  { n: "03", title: "Engine", text: "The only process that owns balances. It fills a whole batch of orders in memory, checks liquidations on every tick, and holds a lock so it never runs twice." },
  { n: "04", title: "Postgres", text: "Each batch is committed in one statement before the engine acknowledges it. On restart the engine rebuilds itself from here." },
];

export default function Home() {
  return (
    <>
      <Nav />
      <main className={styles.page}>
        <section className={styles.hero}>
          <h1 className={`serif ${styles.title}`}>
            Crypto futures, <br />
            <span className="hl">settled</span> on a <span className="hl">stream.</span>
          </h1>
          <div className={styles.heroFoot}>
            <p className={styles.lede}>
              Strata is a demo perpetual futures terminal. Live prices from Backpack, one engine that owns every
              balance, and every fill settled in Postgres. Play money, real architecture.
            </p>
            <div className={styles.heroActions}>
              <Link href="/trade" className="btn">Open the terminal</Link>
              <a href="#how" className="btn btn-ghost">How it works</a>
            </div>
          </div>
        </section>

        <section className={styles.field} aria-label="Bitcoin, last 300 hours">
          <AsciiChart className={styles.ascii} />
          <span className={`label ${styles.fieldCaption}`}>BTC/USDC · 1H · live</span>
        </section>

        <section className={styles.section} aria-labelledby="markets-title">
          <h2 id="markets-title" className={`label ${styles.kicker}`}>Markets</h2>
          <LiveMarkets />
        </section>

        <section id="how" className={styles.section} aria-labelledby="how-title">
          <h2 id="how-title" className={`label ${styles.kicker}`}>How it works</h2>
          <p className={`serif ${styles.statement}`}>
            Prices stream in from Backpack. An engine that owns every balance reads them from <span className="hl">Redis</span>,
            fills your order, and commits the whole batch to <span className="hl">Postgres</span> in one round trip
            <span className={styles.dim}> before it ever says yes. If it crashes, it replays what it had not finished.</span>
          </p>
          <ol className={styles.steps}>
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="num muted">{s.n}</span>
                <h3 className="serif">{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.cta}>
          <p className={`serif ${styles.ctaTitle}`}>$10,000 of play money is <span className="hl">waiting.</span></p>
          <Link href="/trade" className="btn btn-solid">Start trading</Link>
        </section>

        <footer className={styles.foot}>
          <span>Strata is a demo with play money. Nothing here is a real trade or financial advice. Not affiliated with any exchange.</span>
          <span>Prices: Backpack public market data</span>
        </footer>
      </main>
    </>
  );
}
