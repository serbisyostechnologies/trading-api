import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  FRONTEND_ORIGINS: z.string().default("http://localhost:5173"),
  AUTH_REQUIRED: z.enum(["true", "false"]).default("true"),
  JWT_SECRET: z.string().default(""),
  DHAN_CLIENT_ID: z.string().min(1),
  DHAN_ACCESS_TOKEN: z.string().min(1),
  DHAN_AUTH_TYPE: z.string().default("2"),
  DHAN_FEED_VERSION: z.string().default("2"),
  DHAN_INSTRUMENTS_JSON: z.string().default("[]"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;
if (env.NODE_ENV === "production" && env.AUTH_REQUIRED === "true" && env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be at least 32 characters in production.");
  process.exit(1);
}

let instruments;
try {
  instruments = JSON.parse(env.DHAN_INSTRUMENTS_JSON);
} catch {
  throw new Error("DHAN_INSTRUMENTS_JSON must be valid JSON.");
}
if (!Array.isArray(instruments)) throw new Error("DHAN_INSTRUMENTS_JSON must be an array.");

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
const symbols = new Set();
for (const item of validated) {
  if (symbols.has(item.symbol)) throw new Error(`Duplicate instrument symbol: ${item.symbol}`);
  symbols.add(item.symbol);
}

export const config = {
  ...env,
  frontendOrigins: env.FRONTEND_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean),
  authRequired: env.AUTH_REQUIRED === "true",
  instruments: validated,
  instrumentBySymbol: new Map(validated.map((item) => [item.symbol, item])),
};
