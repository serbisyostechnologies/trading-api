import http from "node:http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { DhanFeed } from "./dhan/DhanFeed.js";
import { CandleStore } from "./market/CandleStore.js";
import { createSocketServer } from "./socket.js";
import { createApp } from "./app.js";

const feed = new DhanFeed();
const candleStore = new CandleStore();

const app = createApp({ feed, candleStore });
const server = http.createServer(app);

createSocketServer(server, feed, candleStore);

let shuttingDown = false;

async function start() {
  logger.info("[SERVER] Starting application");

  server.listen(config.PORT, () => {
    logger.info("[SERVER] HTTP server listening", {
      port: config.PORT,
      environment: config.NODE_ENV,
    });

    try {
      logger.info("[SERVER] Initializing Dhan feed");

      feed.start();

      logger.info("[SERVER] Dhan feed initialization completed", {
        status: feed.status(),
      });
    } catch (error) {
      logger.error("[SERVER] Dhan feed initialization failed", {
        message: error.message,
        stack: error.stack,
      });
    }
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("Shutdown requested", { signal });

  try {
    await Promise.resolve(feed.stop());
  } catch (error) {
    logger.error("Dhan feed shutdown failed", {
      message: error.message,
    });
  }

  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", {
    message: String(reason),
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    message: error.message,
    stack: error.stack,
  });

  void shutdown("uncaughtException");
});

start().catch((error) => {
  logger.error("Server startup failed", {
    message: error.message,
  });
  process.exitCode = 1;
});