export const TIME_INTERVALS = [
  { id: "1s", label: "1 Second", value: 1, unit: "second", seconds: 1 },
  { id: "5s", label: "5 Seconds", value: 5, unit: "second", seconds: 5 },
  { id: "10s", label: "10 Seconds", value: 10, unit: "second", seconds: 10 },
  { id: "15s", label: "15 Seconds", value: 15, unit: "second", seconds: 15 },
  { id: "30s", label: "30 Seconds", value: 30, unit: "second", seconds: 30 },
  { id: "1m", label: "1 Minute", value: 1, unit: "minute", seconds: 60 },
  { id: "3m", label: "3 Minutes", value: 3, unit: "minute", seconds: 180 },
  { id: "5m", label: "5 Minutes", value: 5, unit: "minute", seconds: 300 },
  { id: "10m", label: "10 Minutes", value: 10, unit: "minute", seconds: 600 },
  { id: "15m", label: "15 Minutes", value: 15, unit: "minute", seconds: 900 },
  { id: "30m", label: "30 Minutes", value: 30, unit: "minute", seconds: 1800 },
  { id: "45m", label: "45 Minutes", value: 45, unit: "minute", seconds: 2700 },
  { id: "1h", label: "1 Hour", value: 1, unit: "hour", seconds: 3600 },
  { id: "2h", label: "2 Hours", value: 2, unit: "hour", seconds: 7200 },
  { id: "4h", label: "4 Hours", value: 4, unit: "hour", seconds: 14400 },
  { id: "1d", label: "1 Day", value: 1, unit: "day", seconds: 86400 },
  { id: "1w", label: "1 Week", value: 1, unit: "week", seconds: 604800 },
  { id: "1mo", label: "1 Month", value: 1, unit: "month", seconds: 2628000 },
  { id: "3mo", label: "3 Months", value: 3, unit: "month", seconds: 7884000 },
  { id: "6mo", label: "6 Months", value: 6, unit: "month", seconds: 15770000 },
  { id: "1y", label: "1 Year", value: 1, unit: "year", seconds: 31540000 },
];

export const INTERVAL_BY_ID = new Map(
  TIME_INTERVALS.map((item) => [item.id, item])
);