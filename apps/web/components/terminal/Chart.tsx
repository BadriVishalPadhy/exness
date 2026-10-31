"use client";
import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { api } from "../../lib/api";
import { price as fmtPrice } from "../../lib/format";
import { useTick } from "../../lib/live";
import { INTERVALS, type Asset, type Interval, type Position } from "../../lib/types";
import styles from "./terminal.module.css";

const SECONDS: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400 };

export function Chart({ asset, positions }: { asset: Asset; positions: Position[] }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastBar = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const [interval, setTimeframe] = useState<Interval>("15m");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const tick = useTick(asset);

  // Build the chart once.
  useEffect(() => {
    if (!box.current) return;
    const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "monospace";
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "rgba(242,242,245,0.55)", fontFamily: mono, fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: "rgba(242,242,245,0.04)" }, horzLines: { color: "rgba(242,242,245,0.04)" } },
      rightPriceScale: { borderColor: "rgba(242,242,245,0.1)", scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: { borderColor: "rgba(242,242,245,0.1)", timeVisible: true, secondsVisible: false, barSpacing: 8, rightOffset: 6 },
      localization: { priceFormatter: (p: number) => fmtPrice(p) },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(107,107,255,0.6)", labelBackgroundColor: "#2121ff" },
        horzLine: { color: "rgba(107,107,255,0.6)", labelBackgroundColor: "#2121ff" },
      },
    });
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: "#f2f2f5", downColor: "#2121ff", borderVisible: false, wickUpColor: "rgba(242,242,245,0.55)", wickDownColor: "#6b6bff",
    });
    volume.current = c.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, color: "rgba(107,107,255,0.25)", lastValueVisible: false, priceLineVisible: false });
    volume.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => { c.remove(); chart.current = null; };
  }, []);

  // Load candles whenever the market or interval changes.
  useEffect(() => {
    let alive = true;
    setState("loading");
    api.klines(asset, interval)
      .then(({ candles: rows }) => {
        if (!alive || !candles.current || !volume.current) return;
        candles.current.setData(rows.map(([t, o, h, l, c]) => ({ time: t as UTCTimestamp, open: o, high: h, low: l, close: c })));
        volume.current.setData(rows.map(([t, o, , , c, v]) => ({ time: t as UTCTimestamp, value: v, color: c >= o ? "rgba(242,242,245,0.16)" : "rgba(33,33,255,0.35)" })));
        const last = rows[rows.length - 1];
        lastBar.current = last ? { time: last[0], open: last[1], high: last[2], low: last[3], close: last[4] } : null;
        // Show the newest ~120 candles at a readable width; older ones are a scroll away.
        chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, rows.length - 120), to: rows.length + 6 });
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [asset, interval]);

  // Live ticks move the newest candle, or start the next one.
  useEffect(() => {
    if (!tick || !candles.current || state !== "ready") return;
    const bucket = Math.floor(tick.ts / 1000 / SECONDS[interval]) * SECONDS[interval];
    const prev = lastBar.current;
    if (prev && bucket < prev.time) return;
    const bar = prev && bucket === prev.time
      ? { ...prev, high: Math.max(prev.high, tick.price), low: Math.min(prev.low, tick.price), close: tick.price }
      : { time: bucket, open: prev?.close ?? tick.price, high: tick.price, low: tick.price, close: tick.price };
    lastBar.current = bar;
    candles.current.update({ ...bar, time: bar.time as UTCTimestamp });
  }, [tick, interval, state]);

  // Entry and liquidation lines for open positions in this market.
  useEffect(() => {
    const s = candles.current;
    if (!s) return;
    for (const l of lines.current) s.removePriceLine(l);
    lines.current = positions.filter((p) => p.asset === asset).flatMap((p) => [
      s.createPriceLine({ price: p.entryPrice, color: p.side === "long" ? "#3ee08f" : "#ff5c5c", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `${p.side} ${p.leverage}×` }),
      s.createPriceLine({ price: p.liquidationPrice, color: "rgba(255,92,92,0.6)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "liq" }),
    ]);
  }, [positions, asset, state]);

  return (
    <div className={styles.chartWrap}>
      <div className={styles.intervals} role="group" aria-label="Candle interval">
        {INTERVALS.map((i) => (
          <button key={i} type="button" aria-pressed={i === interval} onClick={() => setTimeframe(i)}>{i}</button>
        ))}
        {state === "loading" && <span className="label">Loading…</span>}
        {state === "error" && <span className="label down">Candles unavailable</span>}
      </div>
      <div ref={box} className={styles.chart} />
    </div>
  );
}
