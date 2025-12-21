"use client";

import { useEffect, useState } from "react";

type Kline = [
  number,  // openTime
  string,  // open
  string,  // high
  string,  // low
  string,  // close
  string,  // volume
  number,  // closeTime
  string,
  number,
  string,
  string,
  string
];

export default function KlinesPage() {
  const [asset, setAsset] = useState("BTC");
  const [interval, setInterval] = useState("1m");
  const [klines, setKlines] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchKlines() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(
        `http://localhost:8000/api/v1/klines?asset=${asset}&interval=${interval}`
      );

      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const data = await res.json();

      if (!Array.isArray(data)) {
        throw new Error("Invalid response");
      }

      setKlines(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchKlines();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Klines</h1>

      {/* Controls */}
      <div style={{ marginBottom: 16 }}>
        <select value={asset} onChange={e => setAsset(e.target.value)}>
          <option value="BTC">BTC</option>
          <option value="ETH">ETH</option>
          <option value="SOL">SOL</option>
        </select>

        <select
          value={interval}
          onChange={e => setInterval(e.target.value)}
          style={{ marginLeft: 8 }}
        >
          <option value="1m">1m</option>
          <option value="5m">5m</option>
          <option value="15m">15m</option>
          <option value="1h">1h</option>
          <option value="1d">1d</option>
        </select>

        <button onClick={fetchKlines} style={{ marginLeft: 8 }}>
          Fetch
        </button>
      </div>

      {/* Status */}
      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {/* Table */}
      {klines.length > 0 && (
        <table border={1} cellPadding={6}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Open</th>
              <th>High</th>
              <th>Low</th>
              <th>Close</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>
            {klines.map((kline, index) => (
              <tr key={index}>
                <td>{new Date(kline[0]).toLocaleString()}</td>
                <td>{kline[1]}</td>
                <td>{kline[2]}</td>
                <td>{kline[3]}</td>
                <td>{kline[4]}</td>
                <td>{kline[5]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
