import { Router } from "express";

const assetRouter: Router = Router();

// GET /api/v1/supportedAssets
assetRouter.get('/supportedAssets', async (req, res) => {
  try {
    // Fetch from Engine via HTTP (as per original logic, Engine hosts /prices)
    // Or we could read from a shared Redis stream if Engine published prices there.
    // The original code fetched from localhost:4000/prices

    const response = await fetch('http://localhost:4000/prices');
    const data = await response.json();

    if (!data.prices) {
      return res.json({ assets: [] });
    }

    const assets = Object.keys(data.prices).map(symbol => ({
      symbol,
      name: getAssetName(symbol),
      imageUrl: `https://assets.example.com/${symbol.toLowerCase()}.png`
    }));

    return res.json({ assets });
  } catch (e) {
    // console.log("Error fetching assets", e);
    return res.json({ assets: [] });
  }
});

// Helper function
function getAssetName(symbol: string): string {
  const names: Record<string, string> = {
    'BTC': 'Bitcoin',
    'ETH': 'Ethereum',
    'SOL': 'Solana',
    'USDC': 'USD Coin'
  };
  return names[symbol] || symbol;
}

export default assetRouter;
