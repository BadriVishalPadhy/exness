import type { Metadata, Viewport } from "next";
import { Figtree, Instrument_Serif, Sometype_Mono } from "next/font/google";
import "./globals.css";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });
const sans = Figtree({ subsets: ["latin"], variable: "--font-sans" });
const mono = Sometype_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "Strata — crypto futures, settled on a stream", template: "%s · Strata" },
  description: "A demo perpetual futures terminal with play money: live Backpack prices, Redis Streams, one engine, Postgres settlement.",
};

export const viewport: Viewport = { themeColor: "#04040e", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
