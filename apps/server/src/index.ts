import express from "express";
import cookieParser from "cookie-parser";
// import authRouter from "./routes/auth.route";
import cors from "cors";
import authRouter from "./routes/auth.route";
import tradeRouter from "./routes/balance.route";

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

app.listen(PORT, () => {
  console.log(`server running on PORT ${PORT}`);
});
