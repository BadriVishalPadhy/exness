import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import authRouter from "./routes/auth.route";
import tradeRouter from "./routes/trade.route";
import balanceRouter from "./routes/balance.route";
import assetRouter from "./routes/asset.route";
import klinesRouter from "./routes/klines.route";
import { startEngineConsumer } from "./store";

const app = express();
const PORT = 8000;

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use("/api/v1", authRouter);
app.use("/api/v1", tradeRouter);
app.use("/api/v1", balanceRouter);
app.use("/api/v1", assetRouter);
app.use("/api/v1", klinesRouter);

startEngineConsumer();

app.listen(PORT, () => {
  console.log(`server running on PORT ${PORT}`);
});
