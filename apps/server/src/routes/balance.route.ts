// import { Router } from "express";
// import { CreateNewOrder } from "../types";
// import { ClosePosition } from "../types";
// import { v4 as uuidv4 } from "uuid";
// import Redis from "ioredis";

// const redis = new Redis({
//   port: 6379,
//   host: "localhost",
// });

// const balances = new Map<string,number>();
// const supportedAssets = new Map<string, any>();
// const orders = new Map<string,any>();
// const tradeRouter: Router = Router();
// const pendingAcks = new Map<string,{resolve:Function,reject:Function}>;

// //wait for Ack

// function waitForAck(type:string,orderId:string,timeout=5000){
//   return new Promise((resolve,reject) => {
//     const key = `${type}:${orderId}`;
//     pendingAcks.set(key,{resolve,reject})
//     setTimeout(() =>{reject("Time out")} ,timeout);
//   })
// }


// async function startEngineConsumer(){
//   console.log("startEngineConsumer has started . . .");
//   let lastId = "0-0";
//   while(true){
//     const result = await redis.xread(
//       'BLOCK',5000,
//       'STREAMS','ENGINE_UPDATES',
//       lastId
//     )
//     if(!result) continue; // message nahi mila phirse jao while pe

//     for( const[streamName,message] of result ){
//       for (const[id,fields] of message ){
//         lastId = id;

//         const data:Record<string,string> = {};
//         for(let i= 0;i < fields.length;i += 2 ){

//           const key = fields[i]!;
//           const value =fields[i+1]!;
//           data[key] = value;
//         }
//         switch(data.type){
//           case 'balance_update':
//             const key = `${data.userId}:${data.symbol}`;
//             balances.set(key,parseFloat(data.balance!));
//             break;

//          case 'order_created':
//           const order = JSON.parse(data.order!);
//           orders.set(data.orderId!,order);
//           console.log("order Created",data.orderId);
//           break;

//         case 'order_closed':
//           orders.delete(data.orderId!)
//           console.log("order deleted",data.orderId)
//           break;

//         case 'price_update':
//              if (!supportedAssets.has(data.asset!)) {
//                 supportedAssets.set(data.asset!, {
//                   symbol: data.asset,
//                   name: getAssetName(data.asset!),
//                   imageUrl: `https://assets.example.com/${data.asset!.toLowerCase()}.png`
//                 });
//               }
//               break;

//         case 'order_ack':
//               const ackKey = `order_ack:${data.orderId}`;
//               if (pendingAcks.has(ackKey)) {
//                 const { resolve } = pendingAcks.get(ackKey)!;
//                 resolve({
//                   success: data.success === 'true',
//                   status: data.status,
//                   reason: data.reason
//                 });
//                 pendingAcks.delete(ackKey);
//                 console.log(`✅ Order ACK: ${data.orderId}`);
//               }
//               break;

//         case 'close_ack':
//               const closeKey = `close_ack:${data.orderId}`;
//               if (pendingAcks.has(closeKey)) {
//                 const { resolve } = pendingAcks.get(closeKey)!;
//                 resolve({
//                   success: data.success === 'true',
//                   reason: data.reason,
//                   pnl: data.pnl ? parseFloat(data.pnl) : undefined
//                 });
//                 pendingAcks.delete(closeKey);
//                 console.log(`✅ Close ACK: ${data.orderId}`);
//               }
//               break;

//         }



//       }
//     }
//   }

// }

// startEngineConsumer();

// tradeRouter.post("/trade/create", async (req, res) => {
//   const parseResult = CreateNewOrder.safeParse(req.body);

//   if (!parseResult.success) {
//     // Zod gives exact error message
//     return res.status(400).json({
//       error: "Invalid request",
//       details: parseResult.error
//     });
//   }

//   const data = parseResult.data; // fully validated & typed
//   const orderId = uuidv4();
//   await redis.xadd(
//     "queue",  // << SAME STREAM AS POLLER
//     "*",
//     "kind", "trade",
//     "orderId", orderId,
//     "payload", JSON.stringify(data)
//   );
//   return res.json({ orderId });
// });

// tradeRouter.post("/trade/close", async(req,res) =>{
//   const orderId = ClosePosition.safeParse(req.body);

//   if(!orderId.success){
//     res.status(400).json({
//       error:"Invalid request",
//       details:orderId.error
//       })
//   }
//   const data = orderId.data;

//   await redis.xadd(
//     "queue",
//     "*",
//     "kind","close",
//     "orderId",JSON.stringify(data)
//   )
//   return res.json({
//     status:"OK",
//     "orderId":orderId
//   })
// } );

// tradeRouter.get('/balance/usd',async(req,res) => {
//     const userId = "demo_user"
//     const balance = balances.get(`${userId}:USDC`)

//     return res.json({
//      balance:balance
//     })
// } );

// tradeRouter.get('/balance',async(req,res)=>{
//   const userId = "demo_user";
//   const userBalances: Record<string,{balance:number,decimals:number}> = {}

//     for (const [key, balance] of balances.entries()) {
//     if (key.startsWith(`${userId}:`)) {
//       const symbol = key.split(':')[1];
//       if(!symbol){
//         console.log("symbol not exists")
//         return
//       }
//       userBalances[symbol] = {
//         balance: balance,
//         decimals: 2
//       };
//     }
//   }
//   return res.json(userBalances)
// });

// tradeRouter.get('/supportedAssets', async (req, res) => {
//   const assets = Array.from(supportedAssets.values());

//   return res.json({
//     assets: assets
//   });
// });


// // Helper function
// function getAssetName(symbol: string): string {
//   const names: Record<string, string> = {
//     'BTC': 'Bitcoin',
//     'ETH': 'Ethereum',
//     'SOL': 'Solana',
//     'USDC': 'USD Coin'
//   };
//   return names[symbol] || symbol;
// }


// export default tradeRouter;


import { Router } from "express";
import { CreateNewOrder, ClosePosition } from "../types";
import { v4 as uuidv4 } from "uuid";
import Redis from "ioredis";

const redis = new Redis({
  port: 6379,
  host: "localhost",
});

const tradeRouter: Router = Router();

// ============================================
// IN-MEMORY STORAGE
// ============================================
const balances = new Map<string, number>();
const supportedAssets = new Map<string, any>();
const orders = new Map<string, any>();
const pendingAcks = new Map<string, { resolve: Function; reject: Function }>();

// ============================================
// WAIT FOR ACK (Promise)
// ============================================
function waitForAck(type: string, orderId: string, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const key = `${type}:${orderId}`;
    pendingAcks.set(key, { resolve, reject });

    setTimeout(() => {
      if (pendingAcks.has(key)) {
        pendingAcks.delete(key);
        reject(new Error("Timeout"));
      }
    }, timeout);
  });
}

// ============================================
// ENGINE CONSUMER (Background Loop)
// ============================================
async function startEngineConsumer() {
  console.log("🔄 Engine consumer started...");
  let lastId = "0-0";

  while (true) {
    try {
      const result = await redis.xread(
        'BLOCK', 5000,
        'STREAMS', 'ack_stream', lastId
      );

      if (!result) continue;

      for (const [streamName, messages] of result) {
        for (const [id, fields] of messages) {
          lastId = id;

          // Parse fields
          const data: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            const key = fields[i] as string;
            const value = fields[i + 1] as string;
            data[key] = value;
          }

          console.log(`📥 Received: ${data.type || data.kind}`);

          // Handle different message types
          switch (data.type) {
            case 'balance_update':
              const balKey = `${data.userId}:${data.symbol}`;
              balances.set(balKey, parseFloat(data.balance!));
              console.log(`💰 Balance updated: ${balKey} = ${data.balance}`);
              break;

            case 'order_created':
              const order = JSON.parse(data.order!);
              orders.set(data.orderId!, order);
              console.log(`📈 Order created: ${data.orderId}`);
              break;

            case 'order_closed':
              orders.delete(data.orderId!);
              console.log(`📉 Order closed: ${data.orderId}`);
              break;

            case 'price_update':
              if (!supportedAssets.has(data.asset!)) {
                supportedAssets.set(data.asset!, {
                  symbol: data.asset,
                  name: getAssetName(data.asset!),
                  imageUrl: `https://assets.example.com/${data.asset!.toLowerCase()}.png`
                });
              }
              break;

            case 'order_ack':
              const ackKey = `order_ack:${data.orderId}`;
              if (pendingAcks.has(ackKey)) {
                const { resolve } = pendingAcks.get(ackKey)!;
                resolve({
                  success: data.success === 'true',
                  status: data.status,
                  reason: data.reason
                });
                pendingAcks.delete(ackKey);
                console.log(`✅ Order ACK: ${data.orderId}`);
              }
              break;

            case 'close_ack':
              const closeKey = `close_ack:${data.orderId}`;
              if (pendingAcks.has(closeKey)) {
                const { resolve } = pendingAcks.get(closeKey)!;
                resolve({
                  success: data.success === 'true',
                  reason: data.reason,
                  pnl: data.pnl ? parseFloat(data.pnl) : undefined
                });
                pendingAcks.delete(closeKey);
                console.log(`✅ Close ACK: ${data.orderId}`);
              }
              break;
          }
        }
      }
    } catch (error) {
      console.error('❌ Consumer error:', error);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Start consumer immediately
startEngineConsumer();

// ============================================
// ROUTES
// ============================================

// POST /api/v1/trade/create
tradeRouter.post("/trade/create", async (req, res) => {
  const startTime = Date.now();

  const parseResult = CreateNewOrder.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parseResult.error
    });
  }

  const data = parseResult.data;
  const orderId = uuidv4();
  const userId = "demo_user";

  console.log(`📤 Creating order ${orderId}`);

  // Send to Engine
  await redis.xadd(
    "queue",
    "*",
    "kind", "trade",
    "orderId", orderId,
    "userId", userId,
    "payload", JSON.stringify(data)
  );

  try {
    // Wait for ACK from Engine
    const ack:any = await waitForAck('order_ack', orderId, 10000);

    if (ack.success) {
      return res.json({
        orderId,
        status: ack.status || "created",
        time: Date.now() - startTime
      });
    } else {
      return res.status(500).json({
        error: "Order failed",
        reason: ack.reason,
        time: Date.now() - startTime
      });
    }
  } catch (error) {
    return res.status(500).json({
      error: "Timeout",
      message: "Engine did not respond",
      time: Date.now() - startTime
    });
  }
});

// POST /api/v1/trade/close
tradeRouter.post("/trade/close", async (req, res) => {
  const startTime = Date.now();

  const parseResult = ClosePosition.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parseResult.error
    });
  }

  const data = parseResult.data;
  const userId = "demo_user";

  console.log(`📤 Closing order ${data.orderId}`);

  // Send to Engine
  await redis.xadd(
    "queue",
    "*",
    "kind", "close",
    "orderId", data.orderId,
    "userId", userId
  );

  try {
    // Wait for ACK from Engine
    const ack:any = await waitForAck('close_ack', data.orderId, 10000);

    if (ack.success) {
      return res.json({
        status: "closed",
        orderId: data.orderId,
        pnl: ack.pnl,
        time: Date.now() - startTime
      });
    } else {
      return res.status(500).json({
        error: "Close failed",
        reason: ack.reason,
        time: Date.now() - startTime
      });
    }
  } catch (error) {
    return res.status(500).json({
      error: "Timeout",
      message: "Engine did not respond",
      time: Date.now() - startTime
    });
  }
});

// GET /api/v1/balance/usd
tradeRouter.get('/balance/usd', async (req, res) => {
  const userId = "demo_user";

  console.log("📊 Balance request for:", userId);
  console.log("📦 Current balances cache:", Array.from(balances.entries()));

  let balance = balances.get(`${userId}:USDC`);

  console.log("💰 Found in cache:", balance);

  // If not in cache, fetch from Engine
  if (balance === undefined) {
    console.log("🔄 Fetching from Engine...");
    try {
      const response = await fetch(`http://localhost:4000/balance/${userId}`);
      const data = await response.json();
      balance = data.balance || 0;
      console.log("✅ Got from Engine:", balance);
    } catch (e) {
      console.log("❌ Error fetching from Engine:", e);
      balance = 0;
    }
  }

  return res.json({ balance });
});

// GET /api/v1/balance
tradeRouter.get('/balance', async (req, res) => {
  const userId = "demo_user";
  const userBalances: Record<string, { balance: number; decimals: number }> = {};

  for (const [key, balance] of balances.entries()) {
    if (key.startsWith(`${userId}:`)) {
      const symbol = key.split(':')[1];
      if (symbol) {
        userBalances[symbol] = {
          balance: balance,
          decimals: 2
        };
      }
    }
  }

  return res.json(userBalances);
});

// GET /api/v1/supportedAssets
tradeRouter.get('/supportedAssets', async (req, res) => {
  const assets = Array.from(supportedAssets.values());

  return res.json({
    assets: assets
  });
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

export default tradeRouter;
