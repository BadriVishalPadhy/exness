import express from "express";
import Redis from "ioredis";

const app = express();
const redis = new Redis({
  port: 6379,
  host: "localhost",
});

const PRICES: Record<string, { price: string; decimal: number }> = {}; //Prices array

type UserBalances = Record<string, number>;
let balances: Record<string, UserBalances> = {}; //Balances array

interface Order {
  id: string;
  userId: string;
  asset: string;
  side: "long" | "short";
  qty: number;
  openingPrice: number;
  createdAt: number;
}

let open_orders: Order[] = []; //Orders array

async function priceConsumer() {
  while (true) {
    try {
      const incomingQueueData = await redis.brpop("PriceQueue", 0);

      if(incomingQueueData){
        const [,message] = incomingQueueData;
        const data = JSON.parse(message);
        const priceUpdates = data.price_Updates;
        priceUpdates.forEach((update:any) => {
         const {asset ,price, decimal} = update;
         PRICES[asset] = {price,decimal};

        } )
      }

      //incomingQueueData [
      //   'PriceQueue',
      //   '{"price_Updates":[{"asset":"BTC","price":91510200,"decimal":3},{"asset":"ETH","price":3047880,"decimal":3},{"asset"
      //        :"SOL","price":141820,"decimal":3}]}'
      // ]
    } catch (error) {
      console.error(error)
    }
  }
}

const PORT = 3001;
console.log(`Engine's PORT running at ${PORT}`);
priceConsumer();
