import express from "express";
import Redis from "ioredis";

const app = express();
const PORT = 4000;
const redis = new Redis({
  port: 6379,
  host: "localhost",
});

let PRICES:Record<string,{price:number,decimal:number}> ={};
redis.on("connect", () => {
  console.log("Redis connected successfully");
});

redis.on("error", (error) => {
  console.log("Error", error);
});

async function priceConsumer() {
  while (true) {
    try {
      const pollerData = await redis.xread(
        "BLOCK",
        5000,
        "STREAMS",
        "queue",
        "$"
      );

      if(!pollerData){
        console.log("error reading data from poller");
        return;
      }
      const [queue,queries] = pollerData[0] || [];
      if(!queries){
        console.log("no queries!!!")
        return;
      }
      const [_,message] = queries[0] || [];
      const [__,rest] = message || [];
      const details = JSON.parse(rest as string);
      const data = details.price_Updates;
      data.forEach((update:any) => {
       const {asset,price,decimal} = update
        PRICES[asset]={
          price,
          decimal
        }
        console.log("🚀 ~ priceConsumer ~ PRICES:", PRICES)

      } )

app.get('/prices',(req,res) => {
  res.json({
    price:PRICES
  })
} )

























    } catch (error) {
      console.log("error", error);
    }
  }
}

priceConsumer();

app.listen(PORT, () => {
  console.log(`PORT is running at ${PORT}`);
});
