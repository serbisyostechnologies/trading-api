import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { decodeDhanPacket } from "./decoder.js";

const SEGMENT_CODE = {
  IDX_I: 0, NSE_EQ: 1, NSE_FNO: 2, NSE_CURRENCY: 3,
  BSE_EQ: 4, MCX_COMM: 5, BSE_CURRENCY: 7, BSE_FNO: 8,
};

export class DhanFeed extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.state = "idle";
    this.attempt = 0;
    this.retryTimer = null;
    this.stopped = false;
    this.connecting = false;
    this.desired = new Map(); // symbol -> { symbol, exchangeSegment, securityId, mode }
    this.lastError = null;
  }

  status() {
    return {
      state: this.state,
      connected: this.state === "connected",
      subscriptions: [...this.desired.keys()],
      lastError: this.lastError,
    };
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped || this.connecting) return;
    if (this.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.ws.readyState)) return;

    this.connecting = true;
    this.state = "connecting";
    this.emit("status", this.status());

    const query = new URLSearchParams({
      version: config.DHAN_FEED_VERSION,
      token: config.DHAN_ACCESS_TOKEN,
      clientId: config.DHAN_CLIENT_ID,
      authType: config.DHAN_AUTH_TYPE,
    });
    const socket = new WebSocket(`wss://api-feed.dhan.co?${query.toString()}`, {
      handshakeTimeout: 15_000,
      perMessageDeflate: false,
    });
    this.ws = socket;

    socket.on("open", () => {
      this.connecting = false;
      this.attempt = 0;
      this.state = "connected";
      this.lastError = null;
      logger.info("[DHAN FEED] Connected");
      this.emit("status", this.status());
      this.resubscribeAll();
    });

    socket.on("message", (data, isBinary) => {
      try {
        if (!isBinary && Buffer.isBuffer(data)) {
          // Non-binary messages may be diagnostic text; never log tokens or raw packets.
          logger.warn("[DHAN FEED] Received non-binary message", { message: data.toString("utf8").slice(0, 160) });
          return;
        }
        const packet = decodeDhanPacket(data);
        if (!packet) return;
        if (packet.type === "disconnect") {
          logger.warn("[DHAN FEED] Provider disconnect packet", { disconnectCode: packet.disconnectCode });
          this.lastError = `Dhan disconnect code ${packet.disconnectCode ?? "unknown"}`;
          this.emit("status", this.status());
          return;
        }
        const key = packet.exchangeSegment && packet.securityId
          ? `${packet.exchangeSegment}:${packet.securityId}` : null;
        const instrument = key ? [...this.desired.values()].find(
          (item) => `${item.exchangeSegment}:${item.securityId}` === key
        ) : null;

        if (packet.type === "tick" && instrument && Number.isFinite(packet.ltp) && packet.ltp > 0) {
          const tick = {
            ...packet,
            symbol: instrument.symbol,
            receivedAt: Date.now(),
          };
          this.emit("tick", tick);
        } else if (packet.type === "prevClose" && instrument) {
          this.emit("prevClose", { ...packet, symbol: instrument.symbol, receivedAt: Date.now() });
        } else if (packet.type === "oi" && instrument) {
          this.emit("oi", { ...packet, symbol: instrument.symbol, receivedAt: Date.now() });
        }
      } catch (error) {
        logger.error("[DHAN FEED] Packet decode failed", { error: error.message });
      }
    });

    socket.on("error", (error) => {
      const message = error?.message || "WebSocket error";
      this.lastError = message;
      logger.error("[DHAN FEED] WebSocket error", { message });
      // ws emits close too; reconnect only from close handler to avoid duplicate retries.
    });

    socket.on("unexpected-response", (_request, response) => {
      const statusCode = response.statusCode;
      this.lastError = `HTTP ${statusCode} during Dhan handshake`;
      logger.error("[DHAN FEED] Unexpected server response", { statusCode });
      // A 429 may indicate provider-side rate limiting. Use a longer cooldown.
      if (statusCode === 429) this.attempt = Math.max(this.attempt, 4);
      response.resume();
    });

    socket.on("close", (code, reason) => {
      this.connecting = false;
      if (this.ws === socket) this.ws = null;
      this.state = this.stopped ? "stopped" : "disconnected";
      logger.warn("[DHAN FEED] Closed", { code, reason: reason.toString() });
      this.emit("status", this.status());
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.retryTimer || this.stopped) return;
    this.attempt += 1;
    const base = this.attempt >= 4 ? 60_000 : 2_000;
    const delay = Math.min(base * (2 ** Math.min(this.attempt - 1, 5)), 120_000);
    const jittered = Math.round(delay * (0.8 + Math.random() * 0.4));
    logger.warn("[DHAN FEED] Reconnect scheduled", { attempt: this.attempt, delayMs: jittered });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, jittered);
    this.retryTimer.unref?.();
  }

  subscribe(instrument, mode = "ticker") {
    const validated = config.INSTRUMENTS_BY_SYMBOL.get(String(instrument).toUpperCase());
    if (!validated) throw new Error("Unsupported instrument symbol.");
    const normalizedMode = ["ticker", "quote", "full"].includes(mode) ? mode : "ticker";
    const previous = this.desired.get(validated.symbol);
    const next = { ...validated, mode: normalizedMode };
    this.desired.set(validated.symbol, next);
    // Avoid sending duplicate subscribe messages when another browser joins the same symbol.
    if (this.ws?.readyState === WebSocket.OPEN &&
        (!previous || previous.mode !== normalizedMode ||
         previous.securityId !== next.securityId ||
         previous.exchangeSegment !== next.exchangeSegment)) {
      if (previous && previous.mode !== normalizedMode) {
        this.sendBatch([previous], { ticker: 16, quote: 18, full: 22 }[previous.mode]);
      }
      this.sendSubscriptions([next]);
    }
    return validated;
  }

  unsubscribe(symbol) {
    const item = this.desired.get(String(symbol).toUpperCase());
    if (!item) return false;
    this.desired.delete(item.symbol);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendBatch([item], { ticker: 16, quote: 18, full: 22 }[item.mode]);
    }
    return true;
  }

  sendSubscriptions(items) {
    const byMode = new Map();
    for (const item of items) {
      const list = byMode.get(item.mode) ?? [];
      list.push(item);
      byMode.set(item.mode, list);
    }
    for (const [mode, list] of byMode) {
      const requestCode = { ticker: 15, quote: 17, full: 21 }[mode];
      // Dhan permits up to 100 instruments per subscription message.
      for (let i = 0; i < list.length; i += 100) this.sendBatch(list.slice(i, i + 100), requestCode);
    }
  }

  sendBatch(items, requestCode) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || items.length === 0) return;
    const payload = {
      RequestCode: requestCode,
      InstrumentCount: items.length,
      InstrumentList: items.map((item) => ({
        ExchangeSegment: item.exchangeSegment,
        SecurityId: String(item.securityId),
      })),
    };
    this.ws.send(JSON.stringify(payload), (error) => {
      if (error) logger.error("[DHAN FEED] Subscription send failed", { error: error.message });
    });
  }

  resubscribeAll() {
    this.sendSubscriptions([...this.desired.values()]);
  }

  stop() {
    this.stopped = true;
    this.state = "stopped";
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.ws;
    this.ws = null;
    this.connecting = false;
    if (socket) {
      try {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ RequestCode: 12 }));
        socket.close();
      } catch {}
    }
    this.emit("status", this.status());
  }
}
