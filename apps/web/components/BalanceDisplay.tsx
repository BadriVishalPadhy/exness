"use client";
import { useEffect, useState } from "react";

export function BalanceDisplay() {
  const [balances, setBalances] = useState<Record<string, { balance: number }>>({});

  useEffect(() => {
    const fetchBalance = async () => {
        try {
            const res = await fetch("http://localhost:8000/api/v1/balance");
            if (res.ok) {
                const data = await res.json();
                setBalances(data);
            }
        } catch(e) {
            console.error(e);
        }
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex gap-4 p-4 border-b bg-card">
      <div className="font-bold text-lg">Portfolio:</div>
      {Object.entries(balances).map(([asset, data]) => (
        <div key={asset} className="flex items-center gap-2 text-sm bg-secondary px-3 py-1 rounded-full">
            <span className="font-semibold">{asset}</span>
            <span>{data.balance.toFixed(2)}</span>
        </div>
      ))}
      {Object.keys(balances).length === 0 && <span className="text-muted-foreground text-sm flex items-center">Loading balances...</span>}
    </div>
  );
}
