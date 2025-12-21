import Redis from "ioredis";

// ============================================
// REDIS CLIENT
// ============================================
export const redis = new Redis({
  port: 6379,
  host: "localhost",
});

redis.on("connect", () => console.log("✅ Redis connected (Server)"));
redis.on("error", (err) => console.log("❌ Redis error (Server):", err));

// ============================================
// IN-MEMORY STORAGE
// ============================================
export const balances = new Map<string, number>();
export const supportedAssets = new Map<string, any>();
export const orders = new Map<string, any>();
export const pendingAcks = new Map<string, { resolve: Function; reject: Function }>();

// ============================================
// WAIT FOR ACK (Promise)
// ============================================
export function waitForAck(type: string, orderId: string, timeout = 10000) {
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
export async function startEngineConsumer() {
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

          const data: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            const key = fields[i] as string;
            const value = fields[i + 1] as string;
            data[key] = value;
          }

          switch (data.type) {
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
              }
              break;

            // New: Handle balance/price updates if engine sends them
            // But relying on HTTP pull is also fine as implemented in balance.route originally
          }
        }
      }
    } catch (error) {
      console.error('❌ Consumer error:', error);
      // Wait a bit before retrying to avoid log spam loop
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}
