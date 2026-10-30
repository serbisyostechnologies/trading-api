import { TIME_INTERVALS } from "./intervals.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export class CandleStore {
  constructor({ maxCandlesPerSymbol = 1500 } = {}) {
    this.maxCandlesPerSymbol = maxCandlesPerSymbol;

    // symbol -> intervalId -> candles[]
    this.candlesBySymbol = new Map();

    // symbol -> last tick
    this.lastTickBySymbol = new Map();
  }

  getInterval(intervalId = "1m") {
    const interval = TIME_INTERVALS.find(
      (item) => item.id === intervalId
    );

    if (!interval) {
      throw new Error(`Unsupported candle interval: ${intervalId}`);
    }

    return interval;
  }

  getBucketTime(eventMs, intervalId) {
    const interval = this.getInterval(intervalId);

    // Convert timestamp to Indian Standard Time.
    const istDate = new Date(eventMs + IST_OFFSET_MS);

    const year = istDate.getUTCFullYear();
    const month = istDate.getUTCMonth();
    const day = istDate.getUTCDate();

    const hour = istDate.getUTCHours();
    const minute = istDate.getUTCMinutes();
    const second = istDate.getUTCSeconds();

    let bucketDate;

    switch (interval.unit) {
      case "second": {
        const totalSeconds =
          hour * 3600 + minute * 60 + second;

        const bucketSeconds =
          Math.floor(totalSeconds / interval.value) *
          interval.value;

        bucketDate = new Date(
          Date.UTC(year, month, day) +
            bucketSeconds * 1000
        );

        break;
      }

      case "minute": {
        const totalMinutes = hour * 60 + minute;

        const bucketMinutes =
          Math.floor(totalMinutes / interval.value) *
          interval.value;

        bucketDate = new Date(
          Date.UTC(year, month, day) +
            bucketMinutes * 60_000
        );

        break;
      }

      case "hour": {
        const bucketHour =
          Math.floor(hour / interval.value) *
          interval.value;

        bucketDate = new Date(
          Date.UTC(year, month, day, bucketHour)
        );

        break;
      }

      case "day": {
        bucketDate = new Date(
          Date.UTC(year, month, day)
        );

        break;
      }

      case "week": {
        // Monday is the beginning of the trading week.
        const dayOfWeek = istDate.getUTCDay();

        const daysSinceMonday =
          (dayOfWeek + 6) % 7;

        bucketDate = new Date(
          Date.UTC(year, month, day - daysSinceMonday)
        );

        break;
      }

      case "month": {
        const bucketMonth =
          Math.floor(month / interval.value) *
          interval.value;

        bucketDate = new Date(
          Date.UTC(year, bucketMonth, 1)
        );

        break;
      }

      case "year": {
        const bucketYear =
          Math.floor(year / interval.value) *
          interval.value;

        bucketDate = new Date(
          Date.UTC(bucketYear, 0, 1)
        );

        break;
      }

      default:
        throw new Error(
          `Unsupported interval unit: ${interval.unit}`
        );
    }

    // Convert IST bucket back to Unix seconds.
    return (
      bucketDate.getTime() - IST_OFFSET_MS
    ) / 1000;
  }

  getSymbolIntervals(symbol) {
    if (!this.candlesBySymbol.has(symbol)) {
      this.candlesBySymbol.set(symbol, new Map());
    }

    return this.candlesBySymbol.get(symbol);
  }

  getIntervalCandles(symbol, intervalId) {
    const symbolIntervals = this.getSymbolIntervals(symbol);

    if (!symbolIntervals.has(intervalId)) {
      symbolIntervals.set(intervalId, []);
    }

    return symbolIntervals.get(intervalId);
  }

  onTick(tick, intervalId = "1m") {
    if (
      !Number.isFinite(tick.ltp) ||
      tick.ltp <= 0 ||
      !tick.symbol
    ) {
      return null;
    }

    this.getInterval(intervalId);

    // Exchange last-traded time, otherwise server receive time.
    const eventMs =
      Number.isFinite(tick.ltt) && tick.ltt > 0
        ? tick.ltt * 1000
        : Number.isFinite(tick.receivedAt)
          ? tick.receivedAt
          : Date.now();

    const bucket = this.getBucketTime(
      eventMs,
      intervalId
    );

    const candles = this.getIntervalCandles(
      tick.symbol,
      intervalId
    );

    let candle = candles.find(
      (item) => item.time === bucket
    );

    if (!candle) {
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

      // Maintain chronological order for delayed ticks.
      candles.sort((a, b) => a.time - b.time);

      // A previous candle is finalized when a newer bucket arrives.
      for (const previous of candles) {
        if (previous.time < bucket) {
          previous.isFinal = true;
        }
      }

      while (candles.length > this.maxCandlesPerSymbol) {
        candles.shift();
      }
    } else {
      candle.high = Math.max(candle.high, tick.ltp);
      candle.low = Math.min(candle.low, tick.ltp);

      // Update close only when this tick is newer.
      if (
        !candle.lastEventMs ||
        eventMs >= candle.lastEventMs
      ) {
        candle.close = tick.ltp;
        candle.lastEventMs = eventMs;
      }
    }

    if (Number.isFinite(tick.lastQuantity) && tick.lastQuantity > 0) {
      candle.volume += tick.lastQuantity;
    }

    candle.lastEventMs = Math.max(
      candle.lastEventMs || 0,
      eventMs
    );

    this.lastTickBySymbol.set(tick.symbol, tick);

    return { ...candle };
  }

  getCandles(symbol, limit = 500, intervalId = "1m") {
    this.getInterval(intervalId);

    const candles = this.getIntervalCandles(
      symbol,
      intervalId
    );

    const safeLimit = Math.max(
      1,
      Math.min(limit, this.maxCandlesPerSymbol)
    );

    return candles
      .slice(-safeLimit)
      .map(({ lastEventMs, ...candle }) => ({ ...candle }));
  }

  getLastTick(symbol) {
    const tick = this.lastTickBySymbol.get(symbol);

    return tick ? { ...tick } : null;
  }

  clear(symbol, intervalId) {
    if (!symbol) return;

    if (intervalId) {
      const intervals = this.candlesBySymbol.get(symbol);

      intervals?.delete(intervalId);

      if (intervals?.size === 0) {
        this.candlesBySymbol.delete(symbol);
      }

      return;
    }

    this.candlesBySymbol.delete(symbol);
    this.lastTickBySymbol.delete(symbol);
  }
}