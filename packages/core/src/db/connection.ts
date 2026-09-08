import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import type { PoolConfig } from "pg";

/** URL SSL flags must not override verified TLS configured below. */
export function databaseConnection(connectionString: string): Pick<PoolConfig, "connectionString" | "ssl"> {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URI");
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "postgres", "postgres-test"].includes(url.hostname);
  const supabase = url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".pooler.supabase.com");
  for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) {
    url.searchParams.delete(key);
  }
  return {
    connectionString: url.toString(),
    ssl: local ? false : {
      rejectUnauthorized: true,
      ...(supabase ? { ca: [...rootCertificates, readFileSync(new URL("./certs/supabase-prod-ca-2021.crt", import.meta.url), "utf8")] } : {}),
    },
  };
}
