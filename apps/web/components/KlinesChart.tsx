"use client";
import { useEffect, useState } from "react";

type Kline = [
  number, string, string, string, string, string, number, string, number, string, string, string
];

export function KlinesChart({ asset }: { asset: string }) {
  const [klines, setKlines] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchKlines = async () => {
      setLoading(true);
      try {
        const res = await fetch(`http://localhost:8000/api/v1/klines?asset=${asset}&interval=1h`);
        if (res.ok) {
            const data = await res.json();
            if(Array.isArray(data)) setKlines(data);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchKlines();
  }, [asset]);

  if (loading) return <div className="flex-1 flex items-center justify-center text-muted-foreground">Loading Chat...</div>;

  // Simple visual representation since we don't have a charting library installed properly yet (recharts is in package.json but I'll make a simple SVG or bar representation for "wow" factor if I can, or just table for now to be safe until requested otherwise).
  // Actually, user asked for "make the klines work" previously. I will use a simple canvas or just render the data nicely.
  // Let's try a simple SVG candle chart.

  const maxPrice = Math.max(...klines.map(k => parseFloat(k[2])));
  const minPrice = Math.min(...klines.map(k => parseFloat(k[3])));
  const priceRange = maxPrice - minPrice;

  return (
    <div className="flex-1 p-4 relative bg-background overflow-hidden flex flex-col">
        <div className="absolute top-4 left-4 z-10">
            <h1 className="text-2xl font-bold">{asset}/USDC</h1>
            <div className="text-sm text-muted-foreground">1 Hour Candles</div>
        </div>

        <div className="flex-1 flex items-end gap-[1px] w-full h-full pt-16">
            {klines.slice(-50).map((k, i) => {
                const open = parseFloat(k[1]);
                const close = parseFloat(k[4]);
                const high = parseFloat(k[2]);
                const low = parseFloat(k[3]);

                const isGreen = close >= open;
                const height = ((Math.abs(close - open) / priceRange) * 100);
                const wickHeight = ((high - low) / priceRange) * 100;
                const wickBottom = ((low - minPrice) / priceRange) * 100;
                const bodyBottom = ((Math.min(open, close) - minPrice) / priceRange) * 100;

                return (
                    <div key={i} className="flex-1 relative h-full group hover:opacity-80"  title={`O:${open} H:${high} L:${low} C:${close}`}>
                         {/* Wick */}
                        <div
                            className={`absolute w-[1px] left-1/2 -translate-x-1/2 ${isGreen ? 'bg-green-500' : 'bg-red-500'}`}
                            style={{ bottom: `${wickBottom}%`, height: `${wickHeight}%` }}
                        />
                        {/* Body */}
                        <div
                            className={`absolute w-full mx-[1px] ${isGreen ? 'bg-green-500' : 'bg-red-500'}`}
                            style={{ bottom: `${bodyBottom}%`, height: `${Math.max(height, 1 /* min 1px */)}%` }}
                        />
                    </div>
                );
            })}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground mt-2 border-t pt-2">
            <span>{new Date(klines[klines.length - 50]?.[0] || Date.now()).toLocaleTimeString()}</span>
            <span>{new Date(klines[klines.length - 1]?.[0] || Date.now()).toLocaleTimeString()}</span>
        </div>
    </div>
  );
}
