import dotenv from 'dotenv';
import { z } from "zod";

dotenv.config({
  path: `.env.${process.env.NODE_ENV || 'development'}`,
});

const encodedInstruments = process.env.DHAN_INSTRUMENTS_JSON_B64;

if (!encodedInstruments) {
  throw new Error("DHAN_INSTRUMENTS_JSON_B64 is missing");
}

let instruments;

try {
  const decoded = Buffer
    .from(encodedInstruments, "base64")
    .toString("utf8");

  instruments = JSON.parse(decoded);
} catch (error) {
  throw new Error(
    `Invalid DHAN_INSTRUMENTS_JSON_B64: ${error.message}`
  );
}

if (!Array.isArray(instruments)) {
  throw new Error("DHAN instruments must be a JSON array");
}

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
    DHAN_INSTRUMENTS_JSON: instruments,
    INSTRUMENTS_BY_SYMBOL: new Map(instruments.map((item) => [item.symbol, item])),
}