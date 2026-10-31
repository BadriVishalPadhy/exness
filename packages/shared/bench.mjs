// Engine throughput: pushes N open commands then N close commands straight onto the "commands"
// stream and times how long until every result is back. Run with the engine and poller up.
//   DATABASE_URL=... REDIS_URL=... node packages/shared/bench.mjs 1000
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import pg from "pg";

const N = Number(process.argv[2] ?? 500);
const USERS = 50;
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const reader = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

await pool.query("delete from users where id like 'bench-%'"); // leftovers from an interrupted run
const users = Array.from({ length: USERS }, () => `bench-${randomUUID()}`);
await pool.query("insert into users (id, balance_cents) select unnest($1::text[]), 100000000", [users]);

async function round(commands) {
  const ids = new Set(commands.map((c) => c.id));
  const tail = await reader.xrevrange("results", "+", "-", "COUNT", 1);
  let last = tail[0]?.[0] ?? "0-0"; // start at the current end, captured before publishing
  const results = [];
  const started = performance.now();
  const pipe = redis.pipeline();
  for (const c of commands) pipe.xadd("commands", "*", "m", JSON.stringify(c));
  await pipe.exec();
  while (ids.size) {
    const res = await reader.xread("COUNT", 1000, "BLOCK", 10000, "STREAMS", "results", last);
    if (!res) throw new Error(`timed out with ${ids.size} results missing`);
    for (const [id, fields] of res[0][1]) {
      last = id;
      const r = JSON.parse(fields[1]);
      if (ids.delete(r.id)) results.push(r);
    }
  }
  return { ms: performance.now() - started, results };
}

const opens = Array.from({ length: N }, (_, i) => ({
  kind: "open", id: randomUUID(), userId: users[i % USERS], asset: ["BTC", "ETH", "SOL"][i % 3], side: i % 2 ? "long" : "short", marginCents: 1000, leverage: 5,
}));
const o = await round(opens);
const opened = o.results.filter((r) => r.kind === "opened");
const closes = opened.map((r) => ({ kind: "close", id: randomUUID(), userId: r.userId, positionId: r.position.id }));
const c = await round(closes);

const fmt = (x) => `${x.ms.toFixed(0)} ms, ${((x.results.length / x.ms) * 1000).toFixed(0)} commands/s`;
console.log(`opens:  ${o.results.length} (${opened.length} accepted) in ${fmt(o)}`);
console.log(`closes: ${c.results.length} (${c.results.filter((r) => r.kind === "closed").length} accepted) in ${fmt(c)}`);

const { rows } = await pool.query("select count(*) filter (where closed_at is null) as open, count(*) as total from positions where user_id = any($1)", [users]);
console.log(`postgres: ${rows[0].total} positions written, ${rows[0].open} still open`);
await pool.query("delete from users where id = any($1)", [users]);
await Promise.all([redis.quit(), reader.quit(), pool.end()]);
