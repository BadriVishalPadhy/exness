const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (cents: number) => usd.format(cents / 100);
export const signedMoney = (cents: number) => (cents > 0 ? "+" : cents < 0 ? "−" : "") + usd.format(Math.abs(cents) / 100);

/** Price with sensible precision for its size: 77,612.6 / 2,255.99 / 95.99 */
export function price(p: number | undefined): string {
  if (p === undefined || !Number.isFinite(p)) return "—";
  const digits = p >= 1000 ? 1 : p >= 1 ? 2 : 4;
  return p.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function pct(x: number): string {
  if (!Number.isFinite(x)) return "—";
  return `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(2)}%`;
}
export function compact(x: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(x);
}
export const qty = (q: number) => q.toLocaleString("en-US", { maximumSignificantDigits: 5 });
