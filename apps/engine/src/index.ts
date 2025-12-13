// import express from "express";
// import Redis from "ioredis";

// const app = express();
// const PORT = 4000;
// const redis = new Redis({
//   port: 6379,
//   host: "localhost",
// });

// let PRICES:Record<string,{price:number,decimal:number}> ={};


// redis.on("connect", () => {
//   console.log("Redis connected successfully");
// });

// redis.on("error", (error) => {
//   console.log("Error", error);
// });
// //price consumes from backpack poller
// //to-do
// async function priceConsumer() {
//   while (true) {
//     try {
//       const pollerData = await redis.xread(
//         "BLOCK",
//         5000,
//         "STREAMS",
//         "queue",
//         "$"
//       );

//       if(!pollerData){
//         console.log("error reading data from poller");
//         return;
//       }

//       const [queue,queries] = pollerData[0] || [];
//       if(!queries){
//         console.log("no queries!!!")
//         return;
//       }

//       const [_,message] = queries[0] || [];
//       const [__,rest] = message || [];
//       const details = JSON.parse(rest as string);
//       const data = details.price_Updates;
//       data.forEach((update:any) => {
//        const {asset,price,decimal} = update
//         PRICES[asset]={
//           price,
//           decimal
//         }
//         console.log("🚀 ~ priceConsumer ~ PRICES:", PRICES)

//       } )

// app.get('/prices',(req,res) => {
//   res.json({
//     price:PRICES
//   })
// } )

























//     } catch (error) {
//       console.log("error", error);
//     }
//   }
// }

// function publishToBackend(type:string,   ){

// }

// priceConsumer();

// app.listen(PORT, () => {
//   console.log(`PORT is running at ${PORT}`);
// });











import express from "express";
import Redis from "ioredis";

const app = express();
app.use(express.json());
const PORT = 4000;
const redis = new Redis({
  port: 6379,
  host: "localhost",
});

// ============================================
// DATA STORAGE
// ============================================
let PRICES: Record<string, { price: number; decimal: number }> = {};
let balances: Record<string, number> = {}; // userId -> USDC balance
let orders: any[] = [];

redis.on("connect", () => {
  console.log("✅ Redis connected successfully");
});

redis.on("error", (error) => {
  console.log("❌ Error", error);
});

// ============================================
// SEND ACK TO BACKEND
// ============================================
function sendAck(orderId: string, success: boolean, extra: any = {}) {
  redis.xadd(
    'ack_stream',
    '*',
    'type', success ? (extra.pnl !== undefined ? 'close_ack' : 'order_ack') : (extra.pnl !== undefined ? 'close_ack' : 'order_ack'),
    'orderId', orderId,
    'success', String(success),
    ...Object.entries(extra).flat().map(String)
  );
  console.log(`📤 ACK sent for ${orderId}`);
}

// ============================================
// MAIN CONSUMER - Sequential Processing
// ============================================
async function mainConsumer() {
  console.log("🔄 Consumer started (sequential)");
  let lastId = "0-0";

  while (true) {
    try {
      // Read ONE message at a time from "queue"
      const result = await redis.xread(
        "COUNT", 1,
        "BLOCK", 5000,
        "STREAMS", "queue", lastId
      );

      if (!result) continue;

      const [queue, messages] = result[0] || [];
      if (!messages || messages.length === 0) continue;

      const message = messages[0];
      if (!message) continue;
      const [id, fields] = message;
      lastId = id;

      // Parse message
   // Parse message
const msg: any = {};
for (let i = 0; i < fields.length; i += 2) {
  msg[fields[i] as string] = fields[i + 1];
}

// Auto-detect message type
let kind = msg.kind;

// If no 'kind' field, check if it's from Poller
if (!kind) {
  if (msg.message) {
    // Poller sends: { message: "{price_Updates: [...]}" }
    try {
      const parsed = JSON.parse(msg.message);
      if (parsed.price_Updates) {
        kind = 'price_update';
        msg.payload = msg.message; // Reuse existing handler
      }
    } catch (e) {
      console.log("Failed to parse message:", e);
    }
  }
}

console.log(`\n📥 [${kind}] ${id}`);
console.log("📦 Raw message:", JSON.stringify(msg, null, 2)); // Debug

// Route based on kind
switch (kind) {
  case "price_update":
    handlePriceUpdate(msg);
    break;
  case "trade":
    handleCreateOrder(msg);
    break;
  case "close":
    handleCloseOrder(msg);
    break;
  default:
    console.log(`⚠️ Unknown kind: ${kind}`);
}

    } catch (error) {
      console.log("❌ Error:", error);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ============================================
// HANDLER 1: Price Update (from Poller)
// ============================================
// ============================================
// HANDLER 1: Price Update (from Poller)
// ============================================
function handlePriceUpdate(msg: any) {
  console.log("💰 Processing price update...");

  const payload = JSON.parse(msg.payload || msg.message || msg[Object.keys(msg)[0]!]);
  const updates = payload.price_Updates;

  updates.forEach((update: any) => {
    const { asset, price, decimal } = update;
    PRICES[asset] = { price, decimal };

    const displayPrice = price / Math.pow(10, decimal);
    console.log(`   ${asset}: $${displayPrice.toFixed(2)}`);

    // ✅ SEND TO BACKEND
    redis.xadd(
      'ack_stream',
      '*',
      'type', 'price_update',
      'asset', asset,
      'price', displayPrice.toString(),
      'decimal', decimal.toString()
    );
  });
}

// ============================================
// HANDLER 2: Create Order (from Backend)
// ============================================
function handleCreateOrder(msg: any) {
  const { orderId, userId, payload } = msg;
  console.log(`📈 Creating order ${orderId}...`);

  const data = JSON.parse(payload);
  const { asset, type, margin, leverage } = data;

  // Check price exists
  if (!PRICES[asset]) {
    console.log(`   ❌ No price for ${asset}`);
    sendAck(orderId, false, { status: 'failed', reason: 'no_price' });
    return;
  }

  const currentPrice = PRICES[asset].price / Math.pow(10, PRICES[asset].decimal);
  const marginDollars = margin / 100;
  const cost = marginDollars;
  const qty = (marginDollars * leverage) / currentPrice;

  // Check balance
  const balance = balances[userId] || 0;
  if (balance < cost) {
    console.log(`   ❌ Insufficient balance: ${balance} < ${cost}`);
    sendAck(orderId, false, { status: 'failed', reason: 'insufficient_balance' });
    return;
  }

  // Deduct balance
  balances[userId] = balance - cost;

  // Create order
  const order = {
    id: orderId,
    userId,
    asset,
    side: type,
    qty,
    openingPrice: currentPrice,
    createdAt: Date.now()
  };
  orders.push(order);

  console.log(`   ✅ ${type} ${qty.toFixed(4)} ${asset} @ $${currentPrice}`);
  console.log(`   💰 New balance: $${balances[userId]}`);

  // Send ACK
  sendAck(orderId, true, { status: 'created' });
}

// ============================================
// HANDLER 3: Close Order (from Backend)
// ============================================
function handleCloseOrder(msg: any) {
  const { orderId, userId } = msg;
  console.log(`📉 Closing order ${orderId}...`);

  const orderIdx = orders.findIndex(o => o.id === orderId && o.userId === userId);
  if (orderIdx === -1) {
    console.log(`   ❌ Order not found`);
    sendAck(orderId, false, { reason: 'not_found' });
    return;
  }

  const order = orders[orderIdx];

  // Check price
  if (!PRICES[order.asset]) {
    console.log(`   ❌ No price for ${order.asset}`);
    sendAck(orderId, false, { reason: 'no_price' });
    return;
  }

  const currentPrice = PRICES[order.asset]!.price / Math.pow(10, PRICES[order.asset]!.decimal);

  // Calculate PnL
  let pnl = 0;
  if (order.side === "long") {
    pnl = (currentPrice - order.openingPrice) * order.qty;
  } else {
    pnl = (order.openingPrice - currentPrice) * order.qty;
  }

  // Return balance
  const cost = order.openingPrice * order.qty;
  balances[userId] = (balances[userId] || 0) + cost + pnl;

  // Remove order
  orders.splice(orderIdx, 1);

  console.log(`   ✅ PnL: $${pnl.toFixed(2)}`);
  console.log(`   💰 New balance: $${balances[userId]}`);

  // Send ACK
  sendAck(orderId, true, { pnl: pnl.toFixed(2) });
}

// ============================================
// HTTP ENDPOINTS
// ============================================
app.get('/prices', (req, res) => {
  res.json({ prices: PRICES });
});

app.get('/balance/:userId', (req, res) => {
  const balance = balances[req.params.userId] || 0;
  res.json({ userId: req.params.userId, balance });
});

app.post('/balance/:userId/fund', (req, res) => {
  const { userId } = req.params;
  const { amount } = req.body;
  balances[userId] = (balances[userId] || 0) + amount;
  console.log(`💵 Funded ${userId}: +$${amount} = $${balances[userId]}`);
  res.json({ success: true, balance: balances[userId] });
});

app.get('/orders', (req, res) => {
  res.json({ orders, total: orders.length });
});

// ============================================
// START
// ============================================
app.listen(PORT, () => {
  console.log(`\n🚀 ENGINE running on port ${PORT}`);
  console.log(`📥 Reading from: "queue" stream`);
  console.log(`📤 Sending to: "ack_stream" stream\n`);
  mainConsumer();
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  redis.disconnect();
  process.exit(0);
});
