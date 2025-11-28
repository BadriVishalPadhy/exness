import WebSocket from "ws";
import Redis from "ioredis";
interface PRICE_DATA {
  asset: string;
  price: number;
  decimal: number;
}

const redisClient = new Redis({
  port:6379,
  host:"localhost"
 })

const latestPrice: Map<string, PRICE_DATA> = new Map();

const ASSETS = {
  BTC: { symbol: "BTC_USDC", decimal: 3 },
  SOL: { symbol: "SOL_USDC", decimal: 3 },
  ETH: { symbol: "ETH_USDC", decimal: 3 },
};
let ws: WebSocket;

function connectToBackPack() {

  ws = new WebSocket("wss://ws.backpack.exchange/");
  ws.on("open", () => {
    const streams = Object.values(ASSETS).map(
      (asset) => `ticker.${asset.symbol}`
    );//what u need

    ws.send(
      JSON.stringify(
        ws.send(JSON.stringify({ method: "SUBSCRIBE", params: streams }))
      )
    );//then ask
  });
  ws.on("message", (data: WebSocket.Data) => {
    const parsedData = JSON.parse(data.toString());

    if (parsedData.stream && parsedData.stream.startsWith("ticker.")) {
      const price = parseFloat(parsedData.data.c);
      const symbol = parsedData.data.s;
      console.log("symbol",symbol);

      const assetEntry = Object.entries(ASSETS).find(
        ([_, config]) => config.symbol === symbol
      ); //checks the symbol from websocket is it there in ASSETS and give matching config
      console.log("assetEntry",assetEntry)
      if (!assetEntry) {
        return;
      }
      const [assetName, config] = assetEntry; //destructure
      const priceAsInt = Math.round(price * Math.pow(10, config.decimal));

      latestPrice.set(assetName, {
        asset: assetName,
        price: priceAsInt,
        decimal: config.decimal,
      });
      console.log("Price",price)
    }
  });
  ws.on("error",(error) => {
    console.log(error,"Websocket error");
  } )
}

function startQueuePublisher(){
  setInterval(async()=>{
    if(latestPrice.size === 0){
      return;
    }

    const message = {
      price_Updates : [...latestPrice.values()] //convert map into array
    }

    await redisClient.lpush("PriceQueue", JSON.stringify(message));
    console.log('📤 Pushed to Queue:', JSON.stringify(message, null, 2));
    const queueLength = await redisClient.llen('PriceQueue')
    console.log("queueLength",queueLength);


  },100)
}


connectToBackPack();
startQueuePublisher();
