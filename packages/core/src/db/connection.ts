import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import type { PoolConfig } from "pg";

declare const __DESKROUTE_SUPABASE_CA__: string | undefined;

function supabaseCa() {
  return typeof __DESKROUTE_SUPABASE_CA__ === "string"
    ? __DESKROUTE_SUPABASE_CA__
    : readFileSync(new URL("./certs/supabase-prod-ca-2021.crt", import.meta.url), "utf8");
}

/** URL SSL flags must not override verified TLS configured below. */
export function databaseConnection(connectionString: string): Pick<PoolConfig, "connectionString" | "ssl"> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URI");
  }
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
      ...(supabase ? { ca: [...rootCertificates, supabaseCa()] } : {}),
    },
  };
}
