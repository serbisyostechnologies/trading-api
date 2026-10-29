import http from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { DhanFeed } from "./dhan/DhanFeed.js";
import { CandleStore } from "./market/CandleStore.js";
import { createSocketServer } from "./socket.js";

const app = express();
const server = http.createServer(app);
const feed = new DhanFeed();
const candleStore = new CandleStore();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.frontendOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
}));
app.use(express.json({ limit: "32kb" }));

app.get("/health/live", (_req, res) => res.status(200).json({ ok: true }));
app.get("/health/ready", (_req, res) => {
  const status = feed.status();
  const ready = status.connected;
  res.status(ready ? 200 : 503).json({
    ok: ready,
    service: "dhan-market-stream",
    feed: status,
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.get("/api/instruments", (_req, res) => {
  res.json({
    success: true,
    data: config.instruments.map(({ symbol, exchangeSegment, securityId, label }) => ({
      symbol, exchangeSegment, securityId, label: label ?? symbol,
    })),
  });
});

app.get("/api/market/:symbol/candles", (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!config.instrumentBySymbol.has(symbol)) {
    return res.status(404).json({ success: false, message: "Unknown symbol" });
  }
  const requested = Number.parseInt(req.query.limit ?? "500", 10);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(1500, requested)) : 500;
  return res.json({
    success: true,
    symbol,
    candles: candleStore.getCandles(symbol, limit),
    lastTick: candleStore.getLastTick(symbol),
  });
});

app.use((err, _req, res, _next) => {
  logger.error("HTTP request failed", { error: err.message });
  if (res.headersSent) return;
  res.status(500).json({ success: false, message: "Internal server error" });
});

createSocketServer(server, feed, candleStore);

server.listen(config.PORT, () => {
  logger.info("HTTP server listening", { port: config.PORT, environment: config.NODE_ENV });
  feed.start();
});

function shutdown(signal) {
  logger.info("Shutdown requested", { signal });
  feed.stop();
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => logger.error("Unhandled rejection", { message: String(reason) }));
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { message: error.message, stack: error.stack });
  shutdown("uncaughtException");
});
