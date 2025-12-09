import { Router } from "express";
import { CreateNewOrder } from "../types";
import { ClosePosition } from "../types";
import { v4 as uuidv4 } from "uuid";
import Redis from "ioredis";

const redis = new Redis({
  port: 6379,
  host: "localhost",
});

const balances = new Map<string,number>();
const supportedAssets = new Map<string, any>();
const tradeRouter: Router = Router();
const pendingAcks = new Map<string,{resolve:Function,reject:Function}>;

//wait for Ack

function waitForAck(type:string,orderId:string,timeout=5000){
  return new Promise((resolve,reject) => {
    const key = `${type}:${orderId}`;
    pendingAcks.set(key,{resolve,reject})
    setTimeout(() =>{reject("Time out")} ,timeout);
  })
}
async function startEngineConsumer(){
  console.log("startEngineConsumer has started . . .");
  let lastId = "0-0";
  while(true){
    const result = await redis.xread(
      'BLOCK',5000,
      'STREAMS','ENGINE_UPDATES',
      lastId
    )
    if(!result) continue; // message nahi mila phirse jao while pe
  }

}

tradeRouter.post("/trade/create", async (req, res) => {
  const parseResult = CreateNewOrder.safeParse(req.body);

  if (!parseResult.success) {
    // Zod gives exact error message
    return res.status(400).json({
      error: "Invalid request",
      details: parseResult.error
    });
  }

  const data = parseResult.data; // fully validated & typed
  const orderId = uuidv4();
  await redis.xadd(
    "queue",  // << SAME STREAM AS POLLER
    "*",
    "kind", "trade",
    "orderId", orderId,
    "payload", JSON.stringify(data)
  );
  return res.json({ orderId });
});

tradeRouter.post("/trade/close", async(req,res) =>{
  const orderId = ClosePosition.safeParse(req.body);

  if(!orderId.success){
    res.status(400).json({
      error:"Invalid request",
      details:orderId.error
      })
  }
  const data = orderId.data;

  await redis.xadd(
    "queue",
    "*",
    "kind","close",
    "orderId",JSON.stringify(data)
  )
  return res.json({
    status:"OK",
    "orderId":orderId
  })
} );

tradeRouter.get('/balance/usd',async(req,res) => {
    const userId = "demo_user"
    const balance = balances.get(`${userId}:USDC`)

    return res.json({
     balance:balance
    })
} );

tradeRouter.get('/balance',async(req,res)=>{
  const userId = "demo_user";
  const userBalances: Record<string,{balance:number,decimals:number}> = {}

    for (const [key, balance] of balances.entries()) {
    if (key.startsWith(`${userId}:`)) {
      const symbol = key.split(':')[1];
      if(!symbol){
        console.log("symbol not exists")
        return
      }
      userBalances[symbol] = {
        balance: balance,
        decimals: 2
      };
    }
  }
  return res.json(userBalances)
});

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
