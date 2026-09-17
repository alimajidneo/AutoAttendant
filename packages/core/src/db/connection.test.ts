import { describe, expect, it } from "vitest";
import { databaseConnection } from "./connection.js";

describe("database TLS configuration", () => {
  it("verifies Supabase certificates even if a copied URI disables SSL", () => {
    const config = databaseConnection("postgresql://postgres:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=disable&ssl=false");
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(config.connectionString).not.toContain("ssl");
    expect((config.ssl as {ca: string[]}).ca.some(cert => cert.includes("BEGIN CERTIFICATE"))).toBe(true);
  });
  it("requires verified TLS for other remote databases", () => {
    expect(databaseConnection("postgres://user:secret@db.example.com/app").ssl).toEqual({ rejectUnauthorized: true });
  });
  it("supports local disposable PostgreSQL without TLS", () => {
    expect(databaseConnection("postgres://user:secret@localhost:5433/test").ssl).toBe(false);
  });
  it("rejects malformed URLs without retaining credentials in the error", () => {
    const malformed = "postgresql://admin:super-secret@[";
    let thrown: unknown;

    try {
      databaseConnection(malformed);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("DATABASE_URL must be a valid PostgreSQL connection URI");
    expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();
    expect((thrown as Error & { input?: unknown }).input).toBeUndefined();
    expect((thrown as Error).stack).not.toContain(malformed);
    expect((thrown as Error).stack).not.toContain("super-secret");
  });

  it("rejects an HTTPS project URL", () => {
    expect(() => databaseConnection("https://project.supabase.co")).toThrow("PostgreSQL connection URI");
  });
});
