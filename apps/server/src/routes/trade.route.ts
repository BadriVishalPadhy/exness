import { Router } from "express";
import { CreateNewOrder, ClosePosition } from "../types";
import { v4 as uuidv4 } from "uuid";
import { redis, waitForAck } from "../store";

const tradeRouter: Router = Router();

// POST /api/v1/trade/create
tradeRouter.post("/trade/create", async (req, res) => {
  const startTime = Date.now();
  const orderId = uuidv4();

  // console.log("📤 Creating Order:", orderId);

  // Send to Engine
  await redis.xadd("queue", "*",
    "kind", "trade",
    "orderId", orderId,
    "userId", "demo_user",
    "payload", JSON.stringify(req.body)
  );

  try {
    const ack: any = await waitForAck('order_ack', orderId, 10000);
    return res.json({
      orderId,
      status: ack.status,
      time: Date.now() - startTime
    });
  } catch (error) {
    return res.status(500).json({ error: "Timeout" });
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

  // console.log(`📤 Closing order ${data.orderId}`);

  // Send to Engine
  await redis.xadd("queue", "*",
    "kind", "close",
    "orderId", data.orderId,
    "userId", userId
  );

  try {
    const ack: any = await waitForAck('close_ack', data.orderId, 10000);
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
    return res.status(500).json({ error: "Timeout" });
  }
});

export default tradeRouter;
