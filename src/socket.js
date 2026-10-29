import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { config } from "./config.js";
import { logger } from "./logger.js";

export function createSocketServer(httpServer, feed, candleStore) {
  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin || config.frontendOrigins.includes(origin)) return callback(null, true);
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

  io.use((socket, next) => {
    if (!config.authRequired) return next();
    const token = socket.handshake.auth?.token;
    if (!token || !config.JWT_SECRET) return next(new Error("Authentication required"));
    try {
      const claims = jwt.verify(token, config.JWT_SECRET);
      socket.data.user = { id: claims.sub, role: claims.role };
      return next();
    } catch {
      return next(new Error("Invalid or expired authentication token"));
    }
  });

  io.on("connection", (socket) => {
    logger.info("Socket client connected", { socketId: socket.id });
    socket.emit("market:status", feed.status());

    socket.on("market:subscribe", (payload = {}, ack = () => {}) => {
      try {
        const symbol = String(payload.symbol || "").toUpperCase();
        const mode = payload.mode || "ticker";
        const instrument = feed.subscribe(symbol, mode);
        socket.join(`market:${instrument.symbol}`);
        const candles = candleStore.getCandles(instrument.symbol, 500);
        const lastTick = candleStore.getLastTick(instrument.symbol);
        ack({ ok: true, symbol: instrument.symbol, instrument, candles, lastTick });
        logger.info("Market subscription requested", { socketId: socket.id, symbol: instrument.symbol, mode });
      } catch (error) {
        ack({ ok: false, error: error.message });
      }
    });

    socket.on("market:unsubscribe", (payload = {}, ack = () => {}) => {
      const symbol = String(payload.symbol || "").toUpperCase();
      socket.leave(`market:${symbol}`);
      // A global feed subscription is kept until application-level reference counting
      // is implemented; this prevents one client from unsubscribing everyone else.
      ack({ ok: true, symbol });
    });

    socket.on("disconnect", (reason) => {
      logger.info("Socket client disconnected", { socketId: socket.id, reason });
    });
  });

  feed.on("tick", (tick) => {
    const candle = candleStore.onTick(tick);
    io.to(`market:${tick.symbol}`).emit("market:tick", tick);
    if (candle) io.to(`market:${tick.symbol}`).emit("market:candle", candle);
  });

  feed.on("status", (status) => io.emit("market:status", status));
  feed.on("prevClose", (data) => io.to(`market:${data.symbol}`).emit("market:prevClose", data));
  feed.on("oi", (data) => io.to(`market:${data.symbol}`).emit("market:oi", data));

  return io;
}
