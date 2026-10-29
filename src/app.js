import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { logger } from "./logger.js";

export function createApp({ feed = null, candleStore = null } = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.frontendOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error("Origin not allowed by CORS"));
      },
    }),
  );

  app.use(express.json({ limit: "32kb" }));

  app.get("/health/live", (_req, res) => {
    res.status(200).json({
      ok: true,
      service: "dhan-market-stream-api",
    });
  });

  app.get("/health/ready", (_req, res) => {
    const status = feed?.status?.() ?? {
      state: "external",
      connected: false,
      subscriptions: [],
      lastError: null,
    };

    // The REST API can be healthy even if the feed is external.
    res.status(200).json({
      ok: true,
      service: "dhan-market-stream-api",
      feed: status,
    });
  });

  app.get("/api/instruments", (_req, res) => {
    res.json({
      success: true,
      data: config.instruments.map(
        ({ symbol, exchangeSegment, securityId, label }) => ({
          symbol,
          exchangeSegment,
          securityId,
          label: label ?? symbol,
        }),
      ),
    });
  });

  app.get("/api/market/:symbol/candles", (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();

    if (!config.instrumentBySymbol.has(symbol)) {
      return res.status(404).json({
        success: false,
        message: "Unknown symbol",
      });
    }

    const requested = Number.parseInt(req.query.limit ?? "500", 10);
    const limit = Number.isFinite(requested)
      ? Math.max(1, Math.min(1500, requested))
      : 500;

    return res.json({
      success: true,
      symbol,
      candles: candleStore?.getCandles(symbol, limit) ?? [],
      lastTick: candleStore?.getLastTick(symbol) ?? null,
    });
  });

  app.use((err, _req, res, _next) => {
    logger.error("HTTP request failed", {
      error: err.message,
    });

    if (res.headersSent) return;

    const status = err.message === "Origin not allowed by CORS" ? 403 : 500;

    res.status(status).json({
      success: false,
      message: status === 403 ? "Origin not allowed" : "Internal server error",
    });
  });

  return app;
}