import { Router } from "express";
import { balances } from "../store";

const balanceRouter: Router = Router();

// GET /api/v1/balance/usd
balanceRouter.get('/balance/usd', async (req, res) => {
  const userId = "demo_user";
  let balance = balances.get(`${userId}:USDC`);

  // If not in local cache (since we just restarted server and consumer might not have populated it yet, or this cache is just for updates)
  // Actually, balances are in Engine. Engine is the source of truth.
  // We can fetch from Engine if not known.

  if (balance === undefined) {
    try {
      const response = await fetch(`http://localhost:4000/balance/${userId}`);
      const data = await response.json();
      balance = data.balance || 0;
      // Sync local cache?
      balances.set(`${userId}:USDC`, balance!);
    } catch (e) {
      balance = 0;
    }
  }

  return res.json({ balance });
});


// GET /api/v1/balance
balanceRouter.get('/balance', async (req, res) => {
  // Return all user balances
  // This originally iterated 'balances' Map.
  // But if we use HTTP fetch to engine, we might not have all symbols.
  // For now let's reuse the logic: fetch from Engine is safest as it is stateful.

  // Actually the original code iterated local cache.
  // Let's stick to what was working: Fetch from Engine for "demo_user" is safer than local cache which might start empty.

  // Since Engine exposes /balance/:userId which returns ONE balance (USDC likely),
  // we might need to adjust.
  // Engine's /balance/:userId handler:
  // app.get('/balance/:userId', ... emits { userId, balance })
  // It blindly returns balances[userId].
  // But Engine code uses `balances[userId]` which seems to be a single number (USDC).

  // So /balance/usd is correct. /balance returning map of symbols is ... complicated if Engine only has one balance.
  // Checking Engine code:
  // let balances: Record<string, number> = {}; // userId -> USDC balance
  // It seems Engine only supports one currency balance per user (USDC).

  // So adhering to that:
  const userId = "demo_user";
  try {
    const response = await fetch(`http://localhost:4000/balance/${userId}`);
    const data = await response.json();

    // Original code returned: { USDC: { balance: ..., decimals: 2 } }
    return res.json({
      USDC: {
        balance: data.balance || 0,
        decimals: 2
      }
    });
  } catch (e) {
    return res.json({});
  }
});

export default balanceRouter;
