# Strata

A demo perpetual-futures terminal with play money. Live BTC, ETH and SOL prices from Binance, one
engine that owns every balance, Redis Streams between services, and every fill settled in Postgres.

**Live:** https://strata-futures.vercel.app (frontend) · https://strata-engine-zoex.onrender.com/health (backend)

Play money only. Not affiliated with any exchange.

## Architecture

```
Binance WS  ──▶ poller ──XADD prices──▶ ┌────────────── Redis ──────────────┐
                                        │ prices    (trimmed to ~1000)      │
browser ──HTTP──▶ server ──XADD──────▶  │ commands  (consumer group engine) │ ──▶ engine ──one statement per batch──▶ Postgres
   ▲  ◀──WS ticks / account events──    │ results   (trimmed to ~10000)     │ ◀──
   └────────────────────────────────────└───────────────────────────────────┘
```

| Service | Job |
|---|---|
| `apps/poller` | One WebSocket to Binance (every trade plus a per-second 24h summary) with backoff reconnect and a stale-feed watchdog. Publishes changed markets every 100 ms, and every market at least every 5 s. |
| `apps/engine` | The single owner of balances and positions, held in memory and rebuilt from Postgres on start. Reads commands through a consumer group, applies a batch, commits it to Postgres in **one statement**, then publishes results and `XACK`s in one Redis pipeline. Checks liquidations on every tick. Holds a Redis leader lock so two engines can never split state. |
| `apps/server` | Express API: guest sessions (JWT), account reads from Postgres, orders sent to the engine (the waiter is registered before the command is published), candles from Binance cached 10 s with request de-duplication, and a WebSocket that fans out ticks and nudges a user's tabs when their account changes. |
| `apps/web` | Next.js 16 terminal: landing page with an ASCII chart of live BTC candles, and a trading view with a lightweight-charts candlestick chart, order panel, live PnL and history. |
| `packages/shared` | Config, stream names, message types, money math, Postgres pool and schema. |

### Correctness rules

- Money is integer cents. Opening debits the margin; closing credits margin + PnL; a loss never exceeds the margin.
- Liquidation when the loss reaches 95% of margin: `entry × (1 ∓ 0.95 / leverage)`.
- A command is acknowledged only after its effect is committed. A crash replays unacknowledged commands; opens are idempotent by id, and a repeated close returns the original result.
- If a commit fails, the engine exits and rebuilds from Postgres rather than run with memory ahead of the database.

## Performance

Engine benchmark (`packages/shared/bench.mjs`): N opens then N closes pushed straight onto the
`commands` stream, timed until every result is back. Same machine and database (Mac in India →
Neon in Singapore, ~80 ms round trip):

| Mode | Opens | Closes |
|---|---|---|
| One commit per command (`ENGINE_BATCH=1`) | 9 / s | 9 / s |
| Group commit (default, batch ≤ 200), 2,000 orders | 1,285 / s | 1,380 / s |

All results accepted and every position verified in Postgres after each run.

## Run locally

```bash
pnpm install
export DATABASE_URL=postgres://...      # any Postgres; the schema is created on start
pnpm build:backend
node scripts/supervise.mjs              # starts redis-server, poller, engine and server; needs redis-server on PATH
cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:8000 pnpm dev
```

Server env: `DATABASE_URL`, `REDIS_URL` (default `redis://127.0.0.1:6379`), `JWT_SECRET`, `ALLOWED_ORIGINS` (comma-separated).

## Deploy

- **Backend:** Render free web service from this repo's `Dockerfile`, region Singapore (next to the Neon database). One container runs Redis and the three services under `scripts/supervise.mjs`. Free instances sleep after 15 idle minutes and wake on the next request (~30–60 s); state lives in Postgres, so nothing is lost. Env: `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS=https://strata-futures.vercel.app`.
- **Frontend:** Vercel project with root directory `apps/web` and `NEXT_PUBLIC_API_URL=https://strata-engine-zoex.onrender.com`.
