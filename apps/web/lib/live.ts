"use client";
/**
 * One WebSocket per tab: live ticks for every market plus a nudge when this account changes.
 * Components subscribe through useSyncExternalStore, so a tick only re-renders what reads it.
 */
import { useSyncExternalStore } from "react";
import { WS_URL, currentToken } from "./api";
import type { Asset, Position, Tick } from "./types";

type AccountEvent = { event: string; position?: Position };

let ticks: Partial<Record<Asset, Tick>> = {};
let status: "connecting" | "live" | "offline" = "connecting";
const tickSubs = new Set<() => void>();
const accountSubs = new Set<(e: AccountEvent) => void>();
let socket: WebSocket | null = null;
let started = false;
let retry = 0;

function emit() { for (const fn of tickSubs) fn(); }

function connect() {
  const token = currentToken();
  socket = new WebSocket(token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL);
  socket.onopen = () => { retry = 0; status = "live"; emit(); };
  socket.onmessage = (m) => {
    let msg: { type: string; ticks?: Tick[] } & AccountEvent;
    try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.type === "ticks" && msg.ticks?.length) {
      ticks = { ...ticks };
      for (const t of msg.ticks) ticks[t.asset] = t;
      emit();
    } else if (msg.type === "account") {
      for (const fn of accountSubs) fn(msg);
    }
  };
  socket.onclose = () => {
    status = "offline"; emit();
    setTimeout(connect, Math.min(15_000, 500 * 2 ** retry++));
  };
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  connect();
}

/** Reconnect with the account token once a session exists, so account events reach this tab. */
export function reconnectWithToken() {
  if (socket && socket.url.includes("token=")) return;
  socket?.close();
}

function subscribe(fn: () => void) { start(); tickSubs.add(fn); return () => { tickSubs.delete(fn); }; }

export const useTicks = () => useSyncExternalStore(subscribe, () => ticks, () => ticks);
export const useTick = (asset: Asset) => useSyncExternalStore(subscribe, () => ticks[asset], () => undefined);
export const useLiveStatus = () => useSyncExternalStore(subscribe, () => status, () => "connecting" as const);

export function onAccountEvent(fn: (e: AccountEvent) => void) {
  start();
  accountSubs.add(fn);
  return () => { accountSubs.delete(fn); };
}
