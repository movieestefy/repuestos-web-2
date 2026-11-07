import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isSupabaseOrSsl =
  Boolean(process.env.DATABASE_URL?.includes("supabase.co")) ||
  Boolean(process.env.DATABASE_URL?.includes("pooler.supabase.com")) ||
  Boolean(process.env.DATABASE_URL?.includes("sslmode=require")) ||
  Boolean(process.env.DATABASE_URL?.includes("ssl=true")) ||
  process.env.NODE_ENV === "production";

// Strip query parameters so pg connection options use rejectUnauthorized: false cleanly
const cleanConnString = isSupabaseOrSsl
  ? process.env.DATABASE_URL.split("?")[0]
  : process.env.DATABASE_URL;

// High-concurrency configuration for Supabase Transaction Pooler (PgBouncer, Port 6543)
// Supports up to 2,000 active users with connection throttling and statement timeouts
export const pool = new Pool({
  connectionString: cleanConnString,
  max: 25,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  ssl: isSupabaseOrSsl ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
