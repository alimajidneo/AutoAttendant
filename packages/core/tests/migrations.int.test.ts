import { describe, it, expect, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

/**
 * Migrates into a freshly created database and drops it after, so the chain is
 * proven against genuinely empty state and never touches the shared test database.
 */

const ADMIN_URL = process.env.DATABASE_URL!;
const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle"
);

let scratchDb: string | null = null;

async function withAdmin<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: ADMIN_URL, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

afterEach(async () => {
  if (!scratchDb) return;
  const name = scratchDb;
  scratchDb = null;
  await withAdmin(async (pool) => {
    await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
});

describe("migration chain", () => {
  it("runs to completion against an empty database", async () => {
    const name = `migration_check_${Date.now()}`;
    await withAdmin((pool) => pool.query(`CREATE DATABASE "${name}"`));
    scratchDb = name;

    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 1 });

    try {
      await pool.query('CREATE SCHEMA auth');
      await pool.query('CREATE TABLE auth.users (id uuid PRIMARY KEY, email text)');
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

      const tables = await drizzle(pool).execute(sql`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
      `);
      const names = tables.rows.map((r) => (r as { tablename: string }).tablename);

      expect(names).toEqual(
        expect.arrayContaining([
          "agents",
          "notification_reads",
          "appointments",
          "callers",
          "calls",
          "escalations",
          "knowledge_items",
          "phone_numbers",
          "services",
        ])
      );
    } finally {
      await pool.end();
    }
  }, 60_000);
});


describe("workspace upgrade", () => {
  it("preserves an existing owner, calendar connection and notification receipts", async () => {
    const name = `workspace_upgrade_${Date.now()}`;
    await withAdmin(pool => pool.query(`CREATE DATABASE "${name}"`));
    scratchDb = name;
    const url = new URL(ADMIN_URL); url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 1 });
    const previous = await mkdtemp(path.join(tmpdir(), "deskroute-migrations-"));
    try {
      const journal = JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 7);
      await mkdir(path.join(previous, "meta"));
      await writeFile(path.join(previous, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) await copyFile(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), path.join(previous, `${entry.tag}.sql`));
      await pool.query('CREATE SCHEMA auth');
      await pool.query('CREATE TABLE auth.users (id uuid PRIMARY KEY, email text)');
      await migrate(drizzle(pool), { migrationsFolder: previous });
      const { rows: [agent] } = await pool.query("INSERT INTO agents (business_name, timezone, auth_user_id, calendar_external_id) VALUES ('Existing business', 'UTC', 'existing-owner', 'original-calendar') RETURNING id");
      await pool.query("INSERT INTO notification_reads (agent_id, notification_id, seen_through) VALUES ($1, 'old-notification', now())", [agent.id]);
      await pool.query("INSERT INTO calendar_connections (agent_id, provider_account_id, account_email, encrypted_refresh_token, encryption_owner) VALUES ($1, 'google-account', 'owner@example.test', 'encrypted-fixture', 'original-key-owner')", [agent.id]);
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
      const { rows: [workspace] } = await pool.query("SELECT * FROM workspaces WHERE agent_id = $1", [agent.id]);
      expect(workspace).toMatchObject({ agent_id: agent.id, owner_user_id: "existing-owner", kind: "personal" });
      const { rows: [member] } = await pool.query("SELECT * FROM workspace_members WHERE agent_id = $1", [agent.id]);
      expect(member).toMatchObject({ user_id: "existing-owner", role: "manager" });
      const { rows: [receipt] } = await pool.query("SELECT * FROM notification_reads WHERE agent_id = $1", [agent.id]);
      expect(receipt).toMatchObject({ notification_id: "old-notification", user_id: "existing-owner" });
      const { rows: [connection] } = await pool.query("SELECT * FROM calendar_connections WHERE agent_id = $1", [agent.id]);
      expect(connection).toMatchObject({ encrypted_refresh_token: "encrypted-fixture", encryption_owner: "original-key-owner" });
      const { rows: [original] } = await pool.query("SELECT calendar_external_id FROM agents WHERE id = $1", [agent.id]);
      expect(original.calendar_external_id).toBe("original-calendar");
    } finally { await pool.end(); await rm(previous, { recursive: true, force: true }); }
  }, 60_000);
});
