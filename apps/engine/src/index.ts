import express from "express";
import Redis from "ioredis";

const PORT = 4000;
const app = express();
app.use(express.json());

const redis = new Redis({
  port: 6379,
  host: "localhost",
});


redis.on("connect", () => {
  console.log("✅ Redis connected successfully");
});

redis.on("error", (err) => {
  console.error("❌ Redis connection error:", err);
});



const PRICES: Record<string, { price: number; decimal: number }> = {};
type UserBalances = Record<string, number>;
const balances: Record<string, UserBalances> = {};
type StreamResponse = [string, [string, string[]][]][];

interface Order {
  id: string;
  userId: string;
  asset: string;
  side: "long" | "short";
  qty: number;
  leverage: number;
  openingPrice: number;
  createdAt: number;
}

const open_orders: Order[] = [];



function getFieldValue(fields: string[], key: string): string | undefined {
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i] === key) {
      return fields[i + 1];
    }
  }
  return undefined;
}

function getBalance(userId: string, symbol: string = "USDC"): number {
  if (!balances[userId]) {
    balances[userId] = {};
  }
  return balances[userId][symbol] || 0;
}

function setBalance(userId: string, symbol: string, amount: number): void {
  if (!balances[userId]) {
    balances[userId] = {};
  }
  balances[userId][symbol] = amount;
}

function calculatePnL(order: Order, currentPrice: number): number {
  if (order.side === "long") {
    return (currentPrice - order.openingPrice) * order.qty;
  } else {
    return (order.openingPrice - currentPrice) * order.qty;
  }
}


// PRICE CONSUMER (Redis Stream from Poller)

async function priceConsumer() {
  console.log("📊 Starting price consumer...");

  // First, check if stream exists and has data
  try {
    const streamLength = await redis.xlen("queue");
    console.log(`📊 Stream 'queue' length: ${streamLength}`)

    if (streamLength === 0) {
      console.log("⚠️  WARNING: Stream is empty. Make sure your poller is running!");
    }

    // Try to read existing messages
    const existingMessages = await redis.xread("STREAMS", "queue", "0");
    console.log("📊 Existing messages:", JSON.stringify(existingMessages, null, 2));
  } catch (error) {
    console.error("❌ Error checking stream:", error);
  }

  let lastId = "0"; // Start from beginning

  while (true) {
    try {
      console.log(`🔄 Waiting for messages (lastId: ${lastId})...`);

      const incomingQueueData = (await redis.xread(
        "BLOCK",
        5000, // 5 second timeout
        "STREAMS",
        "queue",
        lastId
      )) as StreamResponse | null;

      if (!incomingQueueData) {
        console.log("⏱️  Timeout - no new messages in 5 seconds");
        continue;
      }

      console.log("📥 Received data!");
      console.log("📥 Raw data:", JSON.stringify(incomingQueueData, null, 2));

      if (incomingQueueData.length > 0) {
        const [streamName, messages] = incomingQueueData[0] ?? [];

        console.log(`📦 Stream name: ${streamName}`);
        console.log(`📦 Number of messages: ${messages?.length || 0}`);

        if (messages && messages.length > 0) {
          for (const [messageId, fields] of messages) {
            lastId = messageId;

            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log("🆔 Message ID:", messageId);
            console.log("📋 Fields array:", fields);
            console.log("📋 Fields length:", fields.length);

            // Extract data from stream
            const dataField = getFieldValue(fields, "message");

            console.log("🔍 Looking for 'data' field...");
            console.log("🔍 Found data field:", dataField ? "YES" : "NO");

            if (dataField) {
              console.log("📄 Raw data field:", dataField.substring(0, 200) + "...");

              try {
                const data = JSON.parse(dataField);
                console.log("✅ Parsed JSON successfully");
                console.log("📊 Data structure:", Object.keys(data));

                const priceUpdates = data.price_Updates;

                if (Array.isArray(priceUpdates)) {
                  console.log(`✅ Found ${priceUpdates.length} price updates`);

                  priceUpdates.forEach((update: any) => {
                    const { asset, price, decimal } = update;
                    PRICES[asset] = { price, decimal };

                    const displayPrice = price / Math.pow(10, decimal);
                    console.log(`💰 ${asset}: $${displayPrice.toFixed(decimal)}`);
                  });
                } else {
                  console.log("❌ price_Updates is not an array:", typeof priceUpdates);
                  console.log("❌ price_Updates value:", priceUpdates);
                }
              } catch (parseError) {
                console.error("❌ JSON parse error:", parseError);
                console.error("❌ Raw data that failed:", dataField);
              }
            } else {
              console.log("❌ No 'data' field found");
              console.log("❌ Available fields:");
              for (let i = 0; i < fields.length; i += 2) {
                console.log(`   - ${fields[i]}: ${fields[i + 1]?.substring(0, 100)}`);
              }
            }
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          }
        }
      }
    } catch (error) {
      console.error("❌ Price consumer error:", error);
      console.error("❌ Error details:", JSON.stringify(error, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ============================================
// ENDPOINTS - PRICES
// ============================================

app.get("/prices", (req, res) => {
  res.json({
    prices: PRICES,
  });
});

app.get("/prices/:asset", (req, res) => {
  const asset = req.params.asset.toUpperCase();
  if (PRICES[asset]) {
    res.json({ asset, ...PRICES[asset] });
  } else {
    res.status(404).json({
      error: "Asset not found",
      availableAssets: Object.keys(PRICES),
    });
  }
});

// ============================================
// ENDPOINTS - BALANCES
// ============================================

app.get("/balances", (req, res) => {
  res.json({ balances });
});

app.get("/balances/:userId", (req, res) => {
  const { userId } = req.params;
  res.json({
    userId,
    balances: balances[userId] || {},
  });
});

app.post("/balances/:userId/fund", (req, res) => {
  const { userId } = req.params;
  const { amount, symbol = "USDC" } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const current = getBalance(userId, symbol);
  setBalance(userId, symbol, current + amount);

  console.log(`💵 Funded ${userId}: +$${amount} ${symbol} (total: $${getBalance(userId, symbol)})`);

  res.json({
    success: true,
    userId,
    symbol,
    oldBalance: current,
    newBalance: getBalance(userId, symbol),
  });
});

// ============================================
// ENDPOINTS - ORDERS
// ============================================

app.get("/orders", (req, res) => {
  res.json({
    orders: open_orders,
    total: open_orders.length,
  });
});

app.get("/orders/:userId", (req, res) => {
  const { userId } = req.params;
  const userOrders = open_orders.filter((o) => o.userId === userId);

  const ordersWithPnL = userOrders.map((order) => {
    const priceData = PRICES[order.asset];
    let currentPnL = 0;

    if (priceData) {
      const currentPrice = priceData.price / Math.pow(10, priceData.decimal);
      currentPnL = calculatePnL(order, currentPrice);
    }

    return { ...order, currentPnL };
  });

  res.json({
    userId,
    orders: ordersWithPnL,
    total: ordersWithPnL.length,
  });
});

app.post("/orders/create", (req, res) => {
  try {
    const { userId, asset, type, margin, leverage, slippage } = req.body;

    if (!userId || !asset || !type || !margin || !leverage) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const priceData = PRICES[asset];
    if (!priceData) {
      return res.status(400).json({ error: "Price not available" });
    }

    const currentPrice = priceData.price / Math.pow(10, priceData.decimal);
    const slippageMultiplier =
      type === "long" ? 1 + ((slippage || 0) / 10000) : 1 - ((slippage || 0) / 10000);
    const openingPrice = currentPrice * slippageMultiplier;
    const marginInDollars = margin / 100;

    const userBalance = getBalance(userId);
    if (userBalance < marginInDollars) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const exposure = marginInDollars * leverage;
    const qty = exposure / openingPrice;

    setBalance(userId, "USDC", userBalance - marginInDollars);

    const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const order: Order = {
      id: orderId,
      userId,
      asset,
      side: type as "long" | "short",
      qty,
      leverage,
      openingPrice,
      createdAt: Date.now(),
    };

    open_orders.push(order);

    console.log(`✅ Order created: ${orderId} | ${userId} | ${type} ${qty.toFixed(4)} ${asset}`);

    res.json({ orderId });
  } catch (error) {
    console.error("❌ Create order error:", error);
    res.status(500).json({ error: "Internal error" });
  }
});

app.post("/orders/close", (req, res) => {
  try {
    const { userId, orderId } = req.body;

    if (!userId || !orderId) {
      return res.status(400).json({ error: "Missing userId or orderId" });
    }

    const orderIndex = open_orders.findIndex(
      (o) => o.id === orderId && o.userId === userId
    );

    if (orderIndex === -1) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = open_orders[orderIndex];

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const priceData = PRICES[order.asset];
    if (!priceData) {
      return res.status(400).json({ error: "Price not available" });
    }

    const currentPrice = priceData.price / Math.pow(10, priceData.decimal);
    const pnl = calculatePnL(order, currentPrice);
    const margin = (order.openingPrice * order.qty) / order.leverage;

    const currentBalance = getBalance(userId);
    setBalance(userId, "USDC", currentBalance + margin + pnl);

    open_orders.splice(orderIndex, 1);

    console.log(`✅ Order closed: ${orderId} | PnL: $${pnl.toFixed(2)}`);

    res.json({ success: true, pnl });
  } catch (error) {
    console.error("❌ Close order error:", error);
    res.status(500).json({ error: "Internal error" });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    dataStructures: {
      prices: Object.keys(PRICES).length,
      balances: Object.keys(balances).length,
      openOrders: open_orders.length,
    },
  });
});

// ============================================
// DEBUG ENDPOINT
// ============================================

app.get("/debug/stream", async (req, res) => {
  try {
    const length = await redis.xlen("queue");
    const messages = await redis.xread("COUNT", 10, "STREAMS", "queue", "0");

    res.json({
      streamLength: length,
      lastMessages: messages,
      currentPrices: PRICES,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`🚀 Engine running on port ${PORT}`);
  console.log("");
  console.log("📊 Data Structures:");
  console.log("   - PRICES");
  console.log("   - balances");
  console.log("   - open_orders");
  console.log("");
  console.log("📡 Endpoints:");
  console.log("   GET  /prices");
  console.log("   GET  /prices/:asset");
  console.log("   GET  /balances");
  console.log("   GET  /balances/:userId");
  console.log("   POST /balances/:userId/fund");
  console.log("   GET  /orders");
  console.log("   GET  /orders/:userId");
  console.log("   POST /orders/create");
  console.log("   POST /orders/close");
  console.log("   GET  /health");
  console.log("   GET  /debug/stream");
  console.log("");

  priceConsumer().catch((error) => console.error(error));
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  redis.disconnect();
  process.exit(0);
});
