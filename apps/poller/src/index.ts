import WebSocket from "ws";
import Redis from "ioredis";

const redisQueue = new Redis({
  host:"localhost",
  port:6379
})

redisQueue.on('connect',() => {
  console.log("Connected to Redis ");
})
redisQueue.on('error',(error) => {
  console.error("Error running the code");
} )

interface PriceData {
  asset: string;
  price: number;
  decimal: number;
}

const latestPrice : Map<string,PriceData> = new Map();
const ASSETS = {
  BTC: { symbol: "BTC_USDC", decimal: 3 },
  SOL: { symbol: "SOL_USDC", decimal: 4 },
  ETH: { symbol: "ETH_USDC", decimal: 3 },
};

let ws: WebSocket

function connectToBackpack() {
  console.log("connecting to backpack ......");
  ws = new WebSocket("wss://ws.backpack.exchange/");

  ws.on("open", () => {
    const streams = Object.values(ASSETS).map(asset =>
      `ticker.${asset.symbol}`
    );

    ws.send(
      JSON.stringify({
        method: "SUBSCRIBE",
        params: streams,
      })
    );

    console.log("connection estd.",streams);

  });

  ws.on("message",(data:WebSocket.Data) => {

      const message = JSON.parse(data.toString());


      try {
        if(message.stream && message.stream.startsWith("ticker.")){
          const tickerData = message.data;
          console.log(tickerData)
          const symbol = tickerData.s;
          console.log(symbol)
          const lastPrice = parseFloat(tickerData.c);
          console.log(lastPrice)

          const assetEntry = Object.entries(ASSETS).find(
            ([_,config]) => config.symbol === symbol
          )
          if(assetEntry){
            const [assetName,config] = assetEntry;
            const priceAsInt = Math.round(
            lastPrice * Math.pow(10, config.decimal)
          )


             const priceData:PriceData = {
             asset:assetName ,
              price: priceAsInt,
              decimal: config.decimal
          }

          latestPrice.set(assetName,priceData);

          console.log(`${assetName} : ${priceAsInt} `);
          console.log(`Full Message`,JSON.stringify(message,null,2));
          console.log(`no. of assets at ${latestPrice.size}`)
          latestPrice.forEach((data,asset) => {
            const displayPrice = data.price / Math.pow(10, data.decimal);
            console.log(`   ${asset}: $${displayPrice.toFixed(2)} (int: ${data.price})`);
          } )


          }



      }
      } catch (error) {
              console.error('❌ Error parsing message:', error);

      }

  } )

}

function startQueuePublisher() {
  console.log("Starting Redis Queue");

  setInterval(async()=>{
    if(latestPrice.size ==  0){
      console.log("waiting for the updates");

    }

  },100)

}

connectToBackpack();

