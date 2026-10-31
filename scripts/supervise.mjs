// Runs Redis and the three services in one container, restarting any that exit (with backoff),
// and forwards SIGTERM so the engine can release its lock and finish its batch.
import { spawn } from "node:child_process";

const procs = [
  { name: "redis", cmd: "redis-server", args: ["--save", "", "--appendonly", "no", "--maxmemory", "64mb", "--maxmemory-policy", "noeviction", "--bind", "127.0.0.1"] },
  { name: "poller", cmd: "node", args: ["apps/poller/dist/index.js"], delay: 500 },
  { name: "engine", cmd: "node", args: ["apps/engine/dist/index.js"], delay: 500 },
  { name: "server", cmd: "node", args: ["apps/server/dist/index.js"], delay: 500 },
];

const children = new Map();
let stopping = false;

function start(p, attempt = 0) {
  const child = spawn(p.cmd, p.args, { stdio: "inherit", env: process.env });
  children.set(p.name, child);
  const startedAt = Date.now();
  child.on("exit", (code, signal) => {
    children.delete(p.name);
    if (stopping) return;
    const next = Date.now() - startedAt > 30_000 ? 0 : attempt + 1;
    const wait = Math.min(15_000, 500 * 2 ** next);
    console.log(`[supervise] ${p.name} exited (${signal ?? code}), restarting in ${wait} ms`);
    setTimeout(() => start(p, next), wait);
  });
}

(async () => {
  for (const p of procs) {
    start(p);
    await new Promise((r) => setTimeout(r, p.delay ?? 300));
  }
})();

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    stopping = true;
    for (const [name, c] of [...children].reverse()) if (name !== "redis") c.kill("SIGTERM");
    setTimeout(() => { children.get("redis")?.kill("SIGTERM"); process.exit(0); }, 3000);
  });
}
