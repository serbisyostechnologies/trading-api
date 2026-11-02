import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { TIME_INTERVALS } from "./market/intervals.js";

export function createSocketServer(httpServer, feed, candleStore) {
  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        const normalize = (value) => value.trim().replace(/\/+$/, "");

        const allowedOrigins = config.FRONTEND_ORIGINS;
        const requestOrigin = origin ? normalize(origin) : null;

        if (!origin || allowedOrigins.includes(requestOrigin)) {
          return callback(null, true);
        }

        logger.warn("CORS origin rejected", {
          requestOrigin,
          allowedOrigins,
        });

        return callback(new Error("Origin not allowed by CORS"));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 1e5,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  // Authentication
  io.use((socket, next) => {
    if (!config.AUTH_REQUIRED) return next();

    const token = socket.handshake.auth?.token;

    if (!token || !config.JWT_SECRET) {
      return next(new Error("Authentication required"));
    }

    try {
      const claims = jwt.verify(token, config.JWT_SECRET);

      socket.data.user = {
        id: claims.sub,
        role: claims.role,
      };

      return next();
    } catch {
      return next(new Error("Invalid or expired authentication token"));
    }
  });

  io.on("connection", (socket) => {
    logger.info("Socket client connected", {
      socketId: socket.id,
    });

    socket.emit("market:status", feed.status());

    // Subscribe to market data
    socket.on("market:subscribe", (payload = {}, ack = () => {}) => {
      try {
        const symbol = String(payload.symbol || "").toUpperCase();
        const mode = payload.mode || "ticker";

        // Selected candle interval from React
        const intervalId = String(payload.interval || "1m");

        const selectedInterval = TIME_INTERVALS.find(
          (item) => item.id === intervalId,
        );

        if (!symbol) {
          throw new Error("Instrument symbol is required");
        }

        if (!selectedInterval) {
          throw new Error(`Invalid time interval: ${intervalId}`);
        }

        // Subscribe to Dhan instrument (interval-independent)
        const instrument = feed.subscribe(symbol, mode);

        // Join tick room
        socket.join(`market:${instrument.symbol}`);

        // Join selected candle interval room
        socket.join(`market:${instrument.symbol}:candles:${intervalId}`);

        // Retrieve candles for selected interval
        const candles = candleStore.getCandles(
          instrument.symbol,
          500,
          intervalId,
        );

        const lastTick = candleStore.getLastTick(instrument.symbol);

        ack({
          ok: true,
          symbol: instrument.symbol,
          mode,
          interval: intervalId,
          intervalSeconds: selectedInterval.seconds,
          instrument,
          candles,
          lastTick,
        });

        logger.info("Market subscription requested", {
          socketId: socket.id,
          symbol: instrument.symbol,
          mode,
          interval: intervalId,
          intervalSeconds: selectedInterval.seconds,
        });
      } catch (error) {
        logger.error("Market subscription failed", {
          socketId: socket.id,
          error: error.message,
        });

        ack({
          ok: false,
          error: error.message,
        });
      }
    });

    // Unsubscribe
    socket.on("market:unsubscribe", (payload = {}, ack = () => {}) => {
      const symbol = String(payload.symbol || "").toUpperCase();
      const intervalId = String(payload.interval || "1m");

      socket.leave(`market:${symbol}`);

      socket.leave(`market:${symbol}:candles:${intervalId}`);

      ack({
        ok: true,
        symbol,
        interval: intervalId,
      });
    });

    socket.on("disconnect", (reason) => {
      logger.info("Socket client disconnected", {
        socketId: socket.id,
        reason,
      });
    });
  });

  // Incoming market ticks
  feed.on("tick", (tick) => {
    for (const interval of TIME_INTERVALS) {
      const candle = candleStore.onTick(tick, interval.id);

      if (candle) {
        io.to(`market:${tick.symbol}:candles:${interval.id}`).emit(
          "market:candle",
          {
            ...candle,
            interval: interval.id,
          },
        );
      }
    }

    io.to(`market:${tick.symbol}`).emit("market:tick", tick);
  });

  feed.on("status", (status) => {
    io.emit("market:status", status);
  });

  feed.on("prevClose", (data) => {
    io.to(`market:${data.symbol}`).emit("market:prevClose", data);
  });

  feed.on("oi", (data) => {
    io.to(`market:${data.symbol}`).emit("market:oi", data);
  });

  return io;
}