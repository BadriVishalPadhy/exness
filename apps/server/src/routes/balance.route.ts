import { Router } from "express";
import { CreateNewOrder } from "../types";
import { v4 as uuidv4 } from "uuid";
import Redis from "ioredis";

const redis = new Redis({
  port: 6379,
  host: "localhost",
});

const tradeRouter: Router = Router();

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

export default tradeRouter;
