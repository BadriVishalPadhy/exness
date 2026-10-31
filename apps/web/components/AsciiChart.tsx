"use client";
/**
 * Real BTC hourly closes drawn as an area of monospace characters: one column per candle, the top
 * edge in white, the fill fading to blue toward the floor, and a faint noise field above. Characters
 * slowly reshuffle, the cursor lights the cells around it, and the newest column follows live ticks.
 */
import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { useTick } from "../lib/live";
import type { Candle } from "../lib/types";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$#%&*+=";
const CELL_W = 10;
const CELL_H = 14;
const FPS = 12;

const randChar = () => CHARS[Math.floor(Math.random() * CHARS.length)]!;

export function AsciiChart({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const closes = useRef<number[]>([]);
  const tick = useTick("BTC");

  useEffect(() => {
    let alive = true;
    api.klines("BTC", "1h").then((r) => { if (alive) closes.current = r.candles.map((c: Candle) => c[4]); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (tick && closes.current.length) closes.current[closes.current.length - 1] = tick.price;
  }, [tick]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "monospace";
    let cols = 0, rows = 0, w = 0, h = 0, grid: string[] = [];
    let mouse = { x: -1e4, y: -1e4 };
    let visible = true, raf = 0, last = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      ({ width: w, height: h } = el.getBoundingClientRect());
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CELL_W);
      rows = Math.ceil(h / CELL_H);
      grid = Array.from({ length: cols * rows }, randChar);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = `500 11px ${family}`;
      ctx.textBaseline = "top";
      for (let i = 0; i < grid.length; i++) if (Math.random() < 0.025) grid[i] = randChar();

      // Fit the newest `cols` closes to the width, scaled into the middle 70% of the height.
      const data = closes.current.slice(-cols);
      const hi = Math.max(...data), lo = Math.min(...data);
      const top = Math.round(rows * 0.12), span = Math.round(rows * 0.68);
      const edgeRow = (p: number) => top + Math.round(((hi - p) / (hi - lo || 1)) * span);
      const offset = cols - data.length;

      for (let c = 0; c < cols; c++) {
        const p = data[c - offset];
        const edge = p === undefined ? rows + 1 : edgeRow(p);
        for (let r = 0; r < rows; r++) {
          const x = c * CELL_W, y = r * CELL_H;
          const glow = Math.max(0, 1 - Math.hypot(x - mouse.x, y - mouse.y) / 150);
          let color: string;
          if (r === edge) color = `rgba(242,242,245,${0.9 + glow * 0.1})`;
          else if (r > edge) {
            const depth = (r - edge) / Math.max(1, rows - edge);
            const tone = Math.round(80 - depth * 30);
            color = `rgba(${tone},${tone},255,${(0.75 - depth * 0.62 + glow * 0.3).toFixed(3)})`;
          } else color = `rgba(90,90,220,${(0.06 + glow * 0.35).toFixed(3)})`;
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
    let once: ReturnType<typeof setInterval> | undefined;
    if (reduced) once = setInterval(() => { if (closes.current.length) { draw(); clearInterval(once); } }, 200);
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); clearInterval(once); ro.disconnect(); io.disconnect();
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <canvas ref={canvas} className={className} role="img" aria-label="Bitcoin hourly closing prices drawn as characters" />;
}
