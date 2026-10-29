// In-memory rolling candle cache. For durable history, persist finalized candles to MongoDB.
export class CandleStore {
  constructor({ maxCandlesPerSymbol = 1500 } = {}) {
    this.maxCandlesPerSymbol = maxCandlesPerSymbol;
    this.candlesBySymbol = new Map();
    this.lastTickBySymbol = new Map();
  }

  onTick(tick) {
    if (!Number.isFinite(tick.ltp) || tick.ltp <= 0 || !tick.symbol) return null;

    // Use exchange last-trade time when present; fallback to server receive time.
    const eventMs = Number.isFinite(tick.ltt) && tick.ltt > 0 ? tick.ltt * 1000 : tick.receivedAt;
    const bucket = Math.floor(eventMs / 60_000) * 60;
    const candles = this.candlesBySymbol.get(tick.symbol) ?? [];
    let candle = candles[candles.length - 1];

    if (!candle || candle.time !== bucket) {
      candle = {
        time: bucket,
        open: tick.ltp,
        high: tick.ltp,
        low: tick.ltp,
        close: tick.ltp,
        volume: 0,
        isFinal: false,
      };
      candles.push(candle);
      while (candles.length > this.maxCandlesPerSymbol) candles.shift();
      this.candlesBySymbol.set(tick.symbol, candles);
    } else {
      candle.high = Math.max(candle.high, tick.ltp);
      candle.low = Math.min(candle.low, tick.ltp);
      candle.close = tick.ltp;
    }

    // Quote packets contain last traded quantity; aggregate only when available.
    if (Number.isFinite(tick.lastQuantity) && tick.lastQuantity > 0) {
      candle.volume += tick.lastQuantity;
    }

    this.lastTickBySymbol.set(tick.symbol, tick);
    return { ...candle };
  }

  getCandles(symbol, limit = 500) {
    const candles = this.candlesBySymbol.get(symbol) ?? [];
    return candles.slice(-Math.max(1, Math.min(limit, this.maxCandlesPerSymbol))).map((c) => ({ ...c }));
  }

  getLastTick(symbol) {
    const tick = this.lastTickBySymbol.get(symbol);
    return tick ? { ...tick } : null;
  }
}
