"use client";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils";

interface Asset {
  symbol: string;
  name: string;
}

export function AssetList({ onSelect, selected }: { onSelect: (asset: string) => void, selected: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/v1/supportedAssets");
        const data = await res.json();
        setAssets(data.assets || []);
      } catch (e) {
        // Fallback if API fails or is empty
        setAssets([
            { symbol: "BTC", name: "Bitcoin" },
            { symbol: "ETH", name: "Ethereum" },
            { symbol: "SOL", name: "Solana" }
        ]);
      }
    };
    fetchAssets();
  }, []);

  return (
    <div className="w-64 border-r bg-card h-full overflow-y-auto">
      <div className="p-4 font-bold border-b">Markets</div>
      <ul>
        {assets.map((asset) => (
          <li
            key={asset.symbol}
            className={cn(
              "px-4 py-3 cursor-pointer hover:bg-secondary/50 transition-colors flex justify-between items-center",
              selected === asset.symbol && "bg-secondary border-l-4 border-primary"
            )}
            onClick={() => onSelect(asset.symbol)}
          >
            <div className="font-medium">{asset.symbol}</div>
            <div className="text-xs text-muted-foreground">{asset.name}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
