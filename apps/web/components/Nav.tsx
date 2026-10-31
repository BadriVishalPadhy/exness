"use client";
import Link from "next/link";
import { useLiveStatus } from "../lib/live";

/** Three stacked bars of falling width: strata. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="4" width="20" height="4" fill="currentColor" />
      <rect x="2" y="10" width="14" height="4" fill="#2121ff" />
      <rect x="2" y="16" width="8" height="4" fill="currentColor" />
    </svg>
  );
}

export function LiveStatus() {
  const s = useLiveStatus();
  return <span className="status" data-state={s}><i aria-hidden="true" />{s === "live" ? "Live" : s === "offline" ? "Reconnecting" : "Connecting"}</span>;
}

export function Nav({ terminal = false }: { terminal?: boolean }) {
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" className="nav__mark" aria-label="Strata home"><Mark /></Link>
      <Link href="/" className="nav__title">Strata</Link>
      <div className="nav__links">
        {terminal ? <LiveStatus /> : <Link href="/trade" className="btn btn-sm btn-solid">Trade</Link>}
      </div>
    </nav>
  );
}
