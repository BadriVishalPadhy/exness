"use client";
/**
 * One WebSocket per tab: live ticks for every market, the order book of the market on screen, and a
 * nudge when this account changes.
 * Components subscribe through useSyncExternalStore, so a tick only re-renders what reads it.
 */
import { useEffect, useSyncExternalStore } from "react";
import { WS_URL, currentToken } from "./api";
import type { Asset, Book, Position, Tick } from "./types";

type AccountEvent = { event: string; position?: Position };

let ticks: Partial<Record<Asset, Tick>> = {};
let books: Partial<Record<Asset, Book>> = {};
let bookAsset: Asset | null = null;
let status: "connecting" | "live" | "offline" = "connecting";
const tickSubs = new Set<() => void>();
const accountSubs = new Set<(e: AccountEvent) => void>();
let socket: WebSocket | null = null;
let started = false;
let retry = 0;

function emit() { for (const fn of tickSubs) fn(); }
function askForBook() {
  if (bookAsset && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "book", asset: bookAsset }));
}

function connect() {
  const token = currentToken();
  socket = new WebSocket(token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL);
  socket.onopen = () => { retry = 0; status = "live"; askForBook(); emit(); };
  socket.onmessage = (m) => {
    let msg: { type: string; ticks?: Tick[]; book?: Book } & AccountEvent;
    try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.type === "ticks" && msg.ticks?.length) {
      ticks = { ...ticks };
      for (const t of msg.ticks) ticks[t.asset] = t;
      emit();
    } else if (msg.type === "book" && msg.book) {
      books = { ...books, [msg.book.asset]: msg.book };
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
  const token = currentToken();
  if (!token || socket?.url.includes(`token=${encodeURIComponent(token)}`)) return;
  socket?.close(); // onclose reconnects with the current token
}

function subscribe(fn: () => void) { start(); tickSubs.add(fn); return () => { tickSubs.delete(fn); }; }

export const useTicks = () => useSyncExternalStore(subscribe, () => ticks, () => ticks);
export const useTick = (asset: Asset) => useSyncExternalStore(subscribe, () => ticks[asset], () => undefined);
/** The live order book for one market; the server only streams the book this tab last asked for. */
export function useBook(asset: Asset) {
  useEffect(() => { bookAsset = asset; start(); askForBook(); }, [asset]);
  return useSyncExternalStore(subscribe, () => books[asset], () => undefined);
}
export const useLiveStatus = () => useSyncExternalStore(subscribe, () => status, () => "connecting" as const);

export function onAccountEvent(fn: (e: AccountEvent) => void) {
  start();
  accountSubs.add(fn);
  return () => { accountSubs.delete(fn); };
}
