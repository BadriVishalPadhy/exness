import type { Account, Candle, Interval, Position } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

const TOKEN_KEY = "strata.token";

export class ApiError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function writeToken(t: string | null) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

let pending: Promise<string> | null = null;
/** The guest token, creating a funded demo account on first use. */
export function ensureToken(): Promise<string> {
  const t = readToken();
  if (t) return Promise.resolve(t);
  pending ??= fetch(`${API_URL}/api/v1/session`, { method: "POST" })
    .then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new ApiError(body.error ?? "session_failed", r.status);
      writeToken(body.token);
      return body.token as string;
    })
    .finally(() => { pending = null; });
  return pending;
}
export const currentToken = readToken;

async function call<T>(path: string, init: RequestInit = {}, authed = true, retried = false): Promise<T> {
  const headers: Record<string, string> = { ...(init.body ? { "Content-Type": "application/json" } : {}) };
  if (authed) headers.Authorization = `Bearer ${await ensureToken()}`;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  // A token the server no longer accepts (expired, or the account is gone): start a fresh guest account once.
  if (res.status === 401 && authed && !retried) { writeToken(null); return call<T>(path, init, authed, true); }
  if (!res.ok) throw new ApiError(body.error ?? `http_${res.status}`, res.status);
  return body as T;
}

export const api = {
  me: () => call<Account>("/api/v1/me"),
  klines: (asset: string, interval: Interval) => call<{ candles: Candle[] }>(`/api/v1/klines?asset=${asset}&interval=${interval}`, {}, false),
  open: (o: { asset: string; side: "long" | "short"; margin: number; leverage: number }) =>
    call<{ kind: "opened"; position: Position; ms: number }>("/api/v1/orders", { method: "POST", body: JSON.stringify(o) }),
  close: (id: string) => call<{ kind: "closed"; position: Position; ms: number }>(`/api/v1/positions/${id}/close`, { method: "POST" }),
  reset: () => call<{ kind: "reset"; balanceCents: number }>("/api/v1/reset", { method: "POST" }),
};

const MESSAGES: Record<string, string> = {
  insufficient_balance: "Not enough available balance for that margin.",
  no_price: "No live price for that market right now. Try again in a moment.",
  not_found: "That position no longer exists.",
  already_closed: "That position is already closing.",
  has_open_positions: "Close your open positions before resetting.",
  slow_down: "Too many orders. Wait a few seconds.",
  engine_timeout: "The engine is busy. Check your positions before retrying.",
  too_many_accounts: "Too many demo accounts from this network. Try later.",
  invalid_order: "Check the margin and leverage.",
};
export const explain = (e: unknown) => (e instanceof ApiError ? MESSAGES[e.code] ?? `Request failed (${e.code}).` : "Network error. Is the API up?");
