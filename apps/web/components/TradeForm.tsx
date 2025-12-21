"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function TradeForm({ asset }: { asset: string }) {
  const [quantity, setQuantity] = useState("1");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{type: 'success'|'error', text: string} | null>(null);

  const handleTrade = async (side: "buy" | "sell") => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("http://localhost:8000/api/v1/trade/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: `${asset}_USDC`,
          userId: "demo_user", // Hardcoded for demo
          price: "100", // Market orders usually don't need price or use better logic, but sticking to simple for now
          quantity: quantity,
          side: side
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: `Order Placed: ${data.orderId.slice(0,8)}...` });
      } else {
        setMessage({ type: "error", text: data.error || "Failed" });
      }
    } catch (e) {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border-l bg-card w-80 flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold mb-4">Trade {asset}</h2>
        <div className="space-y-4">
             <div>
                <label className="text-xs text-muted-foreground mb-1 block">Quantity</label>
                <Input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                />
             </div>
             <div className="grid grid-cols-2 gap-4 pt-2">
                <Button
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => handleTrade("buy")}
                    disabled={loading}
                >
                    Buy
                </Button>
                <Button
                    className="w-full bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => handleTrade("sell")}
                    disabled={loading}
                >
                    Sell
                </Button>
             </div>
        </div>
      </div>

      {message && (
          <div className={`p-3 rounded text-sm ${message.type === 'success' ? 'bg-green-900/50 text-green-200' : 'bg-red-900/50 text-red-200'}`}>
              {message.text}
          </div>
      )}
    </div>
  );
}
