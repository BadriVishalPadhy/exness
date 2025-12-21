"use client";
import { useState } from "react";
import { AssetList } from "../../components/AssetList";
import { BalanceDisplay } from "../../components/BalanceDisplay";
import { TradeForm } from "../../components/TradeForm";
import { KlinesChart } from "../../components/KlinesChart";

export default function TradePage() {
  const [selectedAsset, setSelectedAsset] = useState("BTC");

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
        <BalanceDisplay />
        <div className="flex flex-1 overflow-hidden">
            <AssetList onSelect={setSelectedAsset} selected={selectedAsset} />
            <KlinesChart asset={selectedAsset} />
            <TradeForm asset={selectedAsset} />
        </div>
    </div>
  );
}
