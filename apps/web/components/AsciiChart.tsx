"use client";
/**
 * Real BTC hourly candles drawn as a field of monospace characters: candle bodies in white (up) or
 * blue (down), wicks as dim blue, everything else a faint noise that slowly reshuffles. The cursor
 * lights up the cells around it. The newest candle follows live ticks.
 */
import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { useTick } from "../lib/live";
import type { Candle } from "../lib/types";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$#%&*+=";
const CELL_W = 11;
const CELL_H = 16;
const FPS = 12;

const randChar = () => CHARS[Math.floor(Math.random() * CHARS.length)]!;

export function AsciiChart({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const candles = useRef<Candle[]>([]);
  const tick = useTick("BTC");

  useEffect(() => {
    let alive = true;
    api.klines("BTC", "1h").then((r) => { if (alive) candles.current = r.candles; }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Fold live ticks into the newest candle.
  useEffect(() => {
    const last = candles.current[candles.current.length - 1];
    if (!tick || !last) return;
    last[4] = tick.price;
    last[2] = Math.max(last[2], tick.price);
    last[3] = Math.min(last[3], tick.price);
  }, [tick]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cols = 0, rows = 0, grid: string[] = [];
    let mouse = { x: -1e4, y: -1e4 };
    let visible = true, raf = 0, last = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { width, height } = el.getBoundingClientRect();
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / CELL_W);
      rows = Math.ceil(height / CELL_H);
      grid = Array.from({ length: cols * rows }, randChar);
    };

    const draw = () => {
      const { width, height } = el.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      ctx.font = `500 12px ${getComputedStyle(el).getPropertyValue("--font-mono") || "monospace"}`;
      ctx.textBaseline = "top";
      const data = candles.current.slice(-Math.max(1, Math.floor(cols / 3)));
      // Each candle takes three columns (two-wide body, one gap), right-aligned so the newest sits at the edge.
      const hi = Math.max(...data.map((c) => c[2]));
      const lo = Math.min(...data.map((c) => c[3]));
      const pad = 2;
      const toRow = (p: number) => pad + Math.round(((hi - p) / (hi - lo || 1)) * (rows - pad * 2 - 1));
      const offset = cols - data.length * 3;

      for (let i = 0; i < grid.length; i++) if (Math.random() < 0.03) grid[i] = randChar();

      for (let c = 0; c < cols; c++) {
        const k = c >= offset ? data[Math.floor((c - offset) / 3)] : undefined;
        const isCandleCol = !!k && (c - offset) % 3 !== 2;
        const top = k ? toRow(k[2]) : -1, bottom = k ? toRow(k[3]) : -1;
        const bTop = k ? toRow(Math.max(k[1], k[4])) : -1, bBot = k ? toRow(Math.min(k[1], k[4])) : -1;
        const up = k ? k[4] >= k[1] : true;
        for (let r = 0; r < rows; r++) {
          const x = c * CELL_W, y = r * CELL_H;
          const d = Math.hypot(x - mouse.x, y - mouse.y);
          const glow = Math.max(0, 1 - d / 160);
          let color: string;
          if (isCandleCol && r >= bTop && r <= bBot) color = up ? `rgba(242,242,245,${0.75 + glow * 0.25})` : `rgba(90,90,255,${0.85 + glow * 0.15})`;
          else if (isCandleCol && r >= top && r <= bottom) color = `rgba(70,70,230,${0.45 + glow * 0.4})`;
          else color = `rgba(70,70,210,${0.12 + glow * 0.5})`;
          ctx.fillStyle = color;
          ctx.fillText(grid[r * cols + c]!, x, y);
        }
      }
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden || t - last < 1000 / FPS) return;
      last = t;
      draw();
    };

    resize();
    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; });
    io.observe(el);
    const move = (e: PointerEvent) => { const r = el.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const leave = () => { mouse = { x: -1e4, y: -1e4 }; };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    if (reduced) {
      const once = setInterval(() => { if (candles.current.length) { draw(); clearInterval(once); } }, 200);
      return () => { clearInterval(once); ro.disconnect(); io.disconnect(); };
    }
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, []);

  return <canvas ref={canvas} className={className} role="img" aria-label="Bitcoin hourly candles drawn as characters" />;
}
