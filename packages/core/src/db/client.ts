import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env.js";
import { databaseConnection } from "./connection.js";

/**
 * keepAlive plus a bounded idle timeout, never a short one: holding sockets
 * without TCP probes lets the network reap them and `pg` hands out a dead client.
 */
const pool = new Pool({
  ...databaseConnection(env.DATABASE_URL),
  max: env.DATABASE_POOL_MAX,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  maxUses: 7_500,
});

pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

export const db = drizzle(pool);

/** Pooled sockets are libuv handles, so without this the process ignores SIGINT. */
export async function closeDb(): Promise<void> {
  await pool.end();
}
