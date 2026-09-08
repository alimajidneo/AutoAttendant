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
  it("rejects an HTTPS project URL", () => {
    expect(() => databaseConnection("https://project.supabase.co")).toThrow("PostgreSQL connection URI");
  });
});
