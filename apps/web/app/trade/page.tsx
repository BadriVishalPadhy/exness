import type { Metadata } from "next";
import { Terminal } from "../../components/terminal/Terminal";
import type { Asset } from "../../lib/types";

export const metadata: Metadata = { title: "Terminal" };

export default async function TradePage({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const { asset } = await searchParams;
  const initial: Asset = asset === "ETH" || asset === "SOL" ? asset : "BTC";
  return <Terminal initialAsset={initial} />;
}
