import { spawnSync } from "node:child_process";
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
          "calcom_connections",
          "calcom_webhook_receipts",
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
      await pool.query("INSERT INTO calls (agent_id, room_name, caller_phone, transcript) VALUES ($1, 'legacy-room', '+14155550123', '[{\"role\":\"user\",\"text\":\"Legacy transcript\"}]'::jsonb)", [agent.id]);
      await pool.query("INSERT INTO appointments (agent_id, service_name, status, start_time, end_time) VALUES ($1, 'Legacy booking', 'confirmed', '2026-09-14T10:00:00Z', '2026-09-14T11:00:00Z'), ($1, 'Existing overlap', 'requested', '2026-09-14T10:00:00Z', '2026-09-14T11:00:00Z')", [agent.id]);
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
      const { rows: [legacyCall] } = await pool.query("SELECT provider, provider_call_id, caller_phone, transcript FROM calls WHERE agent_id = $1", [agent.id]);
      expect(legacyCall).toEqual({ provider: 'livekit', provider_call_id: null, caller_phone: '+14155550123', transcript: [{ role: 'user', text: 'Legacy transcript' }] });
      const { rows: legacyAppointments } = await pool.query("SELECT employee_id, status FROM appointments WHERE agent_id = $1", [agent.id]);
      expect(legacyAppointments).toEqual([{ employee_id: null, status: 'confirmed' }, { employee_id: null, status: 'requested' }]);
      const { rows: [workspace] } = await pool.query("SELECT * FROM workspaces WHERE agent_id = $1", [agent.id]);
      expect(workspace).toMatchObject({ agent_id: agent.id, owner_user_id: "existing-owner", kind: "personal" });
      const { rows: [member] } = await pool.query("SELECT * FROM workspace_members WHERE agent_id = $1", [agent.id]);
      expect(member).toMatchObject({ user_id: "existing-owner", role: "manager" });
      const { rows: [receipt] } = await pool.query("SELECT * FROM notification_reads WHERE agent_id = $1", [agent.id]);
      expect(receipt).toMatchObject({ notification_id: "old-notification", user_id: "existing-owner" });
      const { rows: [connection] } = await pool.query("SELECT * FROM calendar_connections WHERE agent_id = $1", [agent.id]);
      expect(connection).toMatchObject({ employee_id: null, encrypted_refresh_token: "encrypted-fixture", encryption_owner: "original-key-owner" });
      const { rows: [original] } = await pool.query("SELECT calendar_external_id FROM agents WHERE id = $1", [agent.id]);
      expect(original.calendar_external_id).toBe("original-calendar");
    } finally { await pool.end(); await rm(previous, { recursive: true, force: true }); }
  }, 60_000);
});

describe("exact deployed Cal.com boundary", () => {
  it("preserves 0011 rows and applies only 0012 with tenant constraints and deny-by-default RLS", async () => {
    const name = `calcom_boundary_${Date.now()}`;
    await withAdmin(pool => pool.query(`CREATE DATABASE "${name}"`));
    scratchDb = name;
    const url = new URL(ADMIN_URL); url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 1 });
    const folder = await mkdtemp(path.join(tmpdir(), "calcom-boundary-"));
    try {
      const journal = JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
      const entries = journal.entries.filter((e: { idx: number }) => e.idx <= 11);
      expect(entries.map((e: { idx: number }) => e.idx)).toEqual(Array.from({ length: 12 }, (_, i) => i));
      await mkdir(path.join(folder, "meta"));
      await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
      for (const e of entries) await copyFile(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(folder, `${e.tag}.sql`));
      await pool.query('CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text)');
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect((await pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBe(12);
      expect((await pool.query("SELECT to_regclass('public.calcom_connections') AS name")).rows[0].name).toBeNull();
      const { rows: [agent] } = await pool.query("INSERT INTO agents (business_name, timezone) VALUES ('Boundary', 'UTC') RETURNING id");
      await pool.query("INSERT INTO workspaces VALUES ($1, 'boundary-owner', 'team')", [agent.id]);
      await pool.query("INSERT INTO workspace_members (agent_id, user_id, role) VALUES ($1, 'boundary-owner', 'manager')", [agent.id]);
      const { rows: [employee] } = await pool.query("INSERT INTO employees (agent_id, display_name, timezone) VALUES ($1, 'Employee', 'UTC') RETURNING id", [agent.id]);
      await pool.query("INSERT INTO retell_connections (agent_id, retell_agent_id) VALUES ($1, 'boundary-agent')", [agent.id]);
      await pool.query("INSERT INTO retell_webhook_receipts (agent_id, dedup_key, event, call_id) VALUES ($1, 'receipt', 'call_ended', 'boundary-call')", [agent.id]);
      await pool.query("INSERT INTO calls (agent_id, room_name, provider, provider_call_id, retell_agent_id) VALUES ($1, 'retell:boundary-call', 'retell', 'boundary-call', 'boundary-agent')", [agent.id]);
      const { rows: [calendar] } = await pool.query("INSERT INTO calendar_connections (agent_id, employee_id, provider_account_id, account_email, encrypted_refresh_token, encryption_owner) VALUES ($1, $2, 'account', 'fixture@example.test', 'opaque-fixture', 'owner') RETURNING id", [agent.id, employee.id]);
      await pool.query("INSERT INTO appointments (agent_id, employee_id, service_name, status, start_time, end_time, external_calendar_connection_id, external_calendar_id, provider_write_state) VALUES ($1, $2, 'Existing', 'requested', '2026-09-14T10:00Z', '2026-09-14T11:00Z', $3, 'calendar', 'reconciliation_required')", [agent.id, employee.id, calendar.id]);
      const tables = ['agents', 'workspaces', 'workspace_members', 'employees', 'retell_connections', 'retell_webhook_receipts', 'calls', 'calendar_connections', 'appointments'];
      const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows] as const)));
      const before = await snapshot();
      expect(Object.values(before).every(rows => rows.length === 1)).toBe(true);
      // The upgrade under test must add exactly one ledger entry, even when later migrations exist.
      // Execute the documented local generator and validate its SQL in a rollback
      // rehearsal on this same scratch 0011 database (never a production service).
      const runbook = await readFile(path.resolve(MIGRATIONS_FOLDER, '../../../docs/CALCOM_INTEGRATION.md'), 'utf8');
      const generator = runbook.split("node --input-type=module <<'NODE'\n")[1]!.split('\nNODE')[0]!;
      const generated = spawnSync(process.execPath, ['--input-type=module'], {
        input: generator, encoding: 'utf8', cwd: path.resolve(MIGRATIONS_FOLDER, '../../..'),
        env: { CALCOM_RUN_DIR: folder },
      });
      expect(generated.stderr).toBe('');
      expect(generated.status).toBe(0);
      const preflight = await readFile(path.join(folder, 'preflight-0011.sql'), 'utf8');
      await pool.query(preflight);
      for (const mutation of ["UPDATE drizzle.__drizzle_migrations SET hash='changed' WHERE id=(SELECT min(id) FROM drizzle.__drizzle_migrations)", "DELETE FROM drizzle.__drizzle_migrations WHERE id=(SELECT max(id) FROM drizzle.__drizzle_migrations)"]) {
        await pool.query('BEGIN');
        try {
          await pool.query(mutation);
          await expect(pool.query(preflight.replace('BEGIN;', ''))).rejects.toThrow('Ledger is not exactly');
        } finally { await pool.query('ROLLBACK'); }
      }
      const applyOnly = await readFile(path.join(folder, 'apply-only-0012.sql'), 'utf8');
      expect(applyOnly).not.toContain('CREATE TABLE "retell_function_invocations"');
      await pool.query(applyOnly.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
      expect(await snapshot()).toEqual(before);
      const boundary = journal.entries.find((e: { idx: number }) => e.idx === 12);
      expect(boundary.tag).toBe('0012_calcom_integration');
      await copyFile(path.join(MIGRATIONS_FOLDER, boundary.tag + '.sql'), path.join(folder, boundary.tag + '.sql'));
      await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: [...entries, boundary] }));
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect((await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'calcom_%' ORDER BY tablename")).rows)
        .toEqual([{ tablename: 'calcom_connections' }, { tablename: 'calcom_webhook_receipts' }]);
      expect(await snapshot()).toEqual(before);
      expect((await pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBe(13);
      const constraints = (await pool.query("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('calcom_connections'::regclass, 'calcom_webhook_receipts'::regclass)")).rows;
      expect(constraints.map(r => r.conname)).toEqual(expect.arrayContaining([
        'calcom_employee_unique', 'calcom_provider_identity_unique', 'calcom_agent_id_unique', 'calcom_auth_kind_check', 'calcom_status_check',
        'calcom_connections_agent_id_workspaces_agent_id_fk', 'calcom_employee_workspace_fk', 'calcom_webhook_receipts_connection_id_calcom_connections_id_fk',
      ]));
      expect(constraints.find(r => r.conname === 'calcom_employee_workspace_fk').definition).toContain('FOREIGN KEY (agent_id, employee_id) REFERENCES employees(agent_id, id)');
      const inherited = (await pool.query("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname IN ('calendar_connections_employee_workspace_fk','appointments_employee_workspace_fk')")).rows;
      expect(inherited).toHaveLength(2);
      expect(inherited.every(r => r.definition.includes('FOREIGN KEY (agent_id, employee_id) REFERENCES employees(agent_id, id)'))).toBe(true);
      const indexes = (await pool.query("SELECT indexname FROM pg_indexes WHERE tablename='calcom_webhook_receipts'")).rows.map(r => r.indexname);
      expect(indexes).toEqual(expect.arrayContaining(['calcom_receipts_connection_time_idx', 'calcom_receipts_time_idx', 'calcom_webhook_receipts_connection_id_digest_pk']));
      expect((await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid IN ('calcom_connections'::regclass, 'calcom_webhook_receipts'::regclass)")).rows).toEqual([{ relrowsecurity: true }, { relrowsecurity: true }]);
      const insert = "INSERT INTO calcom_connections (agent_id, employee_id, encrypted_credential, provider_user_id, account_email, display_label) VALUES ($1,$2,'opaque','provider','fixture@example.test','Fixture') RETURNING id";
      const { rows: [connection] } = await pool.query(insert, [agent.id, employee.id]);
      await expect(pool.query(insert, [agent.id, employee.id])).rejects.toMatchObject({ code: '23505' });
      await expect(pool.query(insert.replace("'provider'", "'other-provider'"), [agent.id, '11111111-1111-4111-8111-111111111111'])).rejects.toMatchObject({ code: '23503' });
      await pool.query('BEGIN');
      try {
        const { rows: [otherAgent] } = await pool.query("INSERT INTO agents (business_name,timezone) VALUES ('Other','UTC') RETURNING id");
        await pool.query("INSERT INTO workspaces VALUES ($1,'other','team')", [otherAgent.id]);
        await expect(pool.query(insert.replace("'provider'", "'cross-tenant'"), [otherAgent.id, employee.id])).rejects.toMatchObject({ code: '23503' });
      } finally { await pool.query('ROLLBACK'); }
      for (const [column, value] of [['auth_kind', 'oauth'], ['status', 'invalid']]) await expect(pool.query(`UPDATE calcom_connections SET ${column}=$1`, [value])).rejects.toMatchObject({ code: '23514' });
      await pool.query("INSERT INTO calcom_webhook_receipts (connection_id,digest,booking_uid,event_type) VALUES ($1,'digest','uid','BOOKING_CREATED')", [connection.id]);
      for (const table of ['calcom_connections', 'calcom_webhook_receipts']) {
        await pool.query('BEGIN');
        try {
          await pool.query('CREATE ROLE boundary_reader NOLOGIN');
          await pool.query(`GRANT USAGE ON SCHEMA public TO boundary_reader; GRANT SELECT, INSERT ON ${table} TO boundary_reader; SET LOCAL ROLE boundary_reader`);
          expect((await pool.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
          await expect(pool.query(`INSERT INTO ${table} SELECT * FROM ${table}`)).resolves.toMatchObject({ rowCount: 0 });
          const denied = table === 'calcom_connections'
            ? () => pool.query(insert, [agent.id, employee.id])
            : () => pool.query("INSERT INTO calcom_webhook_receipts (connection_id,digest,booking_uid,event_type) VALUES ($1,'denied','uid','BOOKING_CREATED')", [connection.id]);
          await expect(denied()).rejects.toMatchObject({ code: '42501' });
        } finally { await pool.query('ROLLBACK'); }
      }
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect((await pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBe(13);
      expect(await snapshot()).toEqual(before);
    } finally { await pool.end(); await rm(folder, { recursive: true, force: true }); }
  }, 60_000);
});
