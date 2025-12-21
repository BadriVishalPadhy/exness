import { Router } from "express";

const klinesRouter: Router = Router();

// GET /api/v1/klines?asset=BTC&interval=1m
klinesRouter.get('/klines', async (req, res) => {
  try {
    const { asset, interval, limit } = req.query;

    // Validate asset
    if (!asset || typeof asset !== 'string') {
      return res.status(400).json({
        error: 'Asset is required',
        example: '/api/v1/klines?asset=BTC&interval=1m'
      });
    }

    // Binance symbol format (no underscore, use USDT)
    const symbol = `${asset.toUpperCase()}USDT`;

    // Default interval and limit
    const candleInterval = (interval as string) || '1m';
    const candleLimit = (limit as string) || '500';

    // Validate interval
    const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
    if (!validIntervals.includes(candleInterval)) {
      return res.status(400).json({
        error: 'Invalid interval',
        validIntervals,
        provided: candleInterval
      });
    }

    // Build Binance API URL
    const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${candleInterval}&limit=${candleLimit}`;

    console.log(`📊 Fetching candles: ${asset} (${candleInterval})`);
    console.log(`🔗 Binance URL: ${binanceUrl}`);

    // Fetch from Binance
    const response = await fetch(binanceUrl);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Binance error: ${response.status} - ${errorText}`);
      throw new Error(`Binance API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error('Invalid response format from Binance');
    }

    console.log(`✅ Received ${data.length} candles`);

    // Remove last candle (incomplete/current candle)
    if (data.length > 0) {
      data.pop();
      console.log(`✅ Returning ${data.length} candles (last removed)`);
    }

    // Binance returns same format as Backpack:
    // [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]
    return res.json(data);

  } catch (error: any) {
    console.error('❌ Klines error:', error);
    return res.status(500).json({
      error: 'Failed to fetch candles',
      message: error.message,
      hint: 'Try a different asset (BTC, ETH, SOL) or interval'
    });
  }
});

export default klinesRouter;
