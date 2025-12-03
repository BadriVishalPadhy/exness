import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "./routes";
import cors from "cors";

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

app.listen(PORT, () => {
  console.log(`server running on PORT ${PORT}`);
});
