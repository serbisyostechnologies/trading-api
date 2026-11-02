import dotenv from 'dotenv';
import { z } from "zod";

dotenv.config({
  path: `.env.${process.env.NODE_ENV || 'development'}`,
});

const instruments = JSON.parse(process.env.DHAN_INSTRUMENTS_JSON);
const instrumentSchema = z.object({
  symbol: z.string().min(1).max(40).transform((v) => v.toUpperCase()),
  exchangeSegment: z.enum(["IDX_I", "NSE_EQ", "NSE_FNO", "NSE_CURRENCY", "BSE_EQ", "MCX_COMM", "BSE_CURRENCY", "BSE_FNO"]),
  securityId: z.string().min(1),
  label: z.string().min(1).max(100).optional(),
});
const validated = instruments.map((item, index) => {
  const result = instrumentSchema.safeParse(item);
  if (!result.success) throw new Error(`Invalid instrument at index ${index}: ${JSON.stringify(result.error.flatten())}`);
  return result.data;
});

export const config = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: Number(process.env.PORT) || 8000,
    FRONTEND_ORIGINS: process.env.FRONTEND_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean) || "http://localhost:5173",
    AUTH_REQUIRED: false,
    JWT_SECRET: process.env.JWT_SECRET || '',
    DHAN_CLIENT_ID: process.env.DHAN_CLIENT_ID || 1,
    DHAN_ACCESS_TOKEN: process.env.DHAN_ACCESS_TOKEN || 1,
    DHAN_AUTH_TYPE: process.env.DHAN_AUTH_TYPE || "2",
    DHAN_FEED_VERSION: process.env.DHAN_FEED_VERSION || "2",
    DHAN_INSTRUMENTS_JSON: JSON.parse(process.env.DHAN_INSTRUMENTS_JSON) || {},
    INSTRUMENTS_BY_SYMBOL: new Map(validated.map((item) => [item.symbol, item])),
}