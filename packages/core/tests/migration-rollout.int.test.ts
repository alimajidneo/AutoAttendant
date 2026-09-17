import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const ADMIN_URL = process.env.DATABASE_URL!;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATIONS = path.join(ROOT, "packages/core/drizzle");
const SCRIPT = path.join(ROOT, "scripts/generate-0011-to-0014-rollout.mjs");
let scratchDatabase: string | null = null;
const temporaryDirectories: string[] = [];

async function withAdmin<T>(callback: (pool: Pool) => Promise<T>) {
  const pool = new Pool({ connectionString: ADMIN_URL, max: 1 });
  try { return await callback(pool); } finally { await pool.end(); }
}

async function createBoundaryFolder() {
  const folder = await mkdtemp(path.join(tmpdir(), "deskroute-0011-boundary-"));
  temporaryDirectories.push(folder);
  await mkdir(path.join(folder, "meta"));
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS, "meta/_journal.json"), "utf8"));
  const entries = journal.entries.slice(0, 12);
  await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  await Promise.all(entries.map((entry: { tag: string }) =>
    copyFile(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`))));
  return folder;
}

function executableSql(sql: string) {
  return sql.replace(/^\\set ON_ERROR_STOP on\n/, "");
}

afterEach(async () => {
  if (scratchDatabase) {
    const name = scratchDatabase;
    scratchDatabase = null;
    await withAdmin((pool) => pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("checksum-bound 0011 to 0014 rollout", () => {
  it("rejects wrong, missing, or extra predecessor rows then atomically applies and verifies exactly 0012 through 0014", async () => {
    const name = `rollout_gate_${Date.now()}`;
    await withAdmin((pool) => pool.query(`CREATE DATABASE "${name}"`));
    scratchDatabase = name;
    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 1 });
    const boundaryFolder = await createBoundaryFolder();
    const outputFolder = await mkdtemp(path.join(tmpdir(), "deskroute-rollout-artifacts-"));
    temporaryDirectories.push(outputFolder);

    try {
      await pool.query("CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text)");
      await migrate(drizzle(pool), { migrationsFolder: boundaryFolder });
      const generated = spawnSync(process.execPath, [SCRIPT, "--output-dir", outputFolder], { cwd: ROOT, encoding: "utf8" });
      expect(generated.status, generated.stderr).toBe(0);
      const preflight = executableSql(await readFile(path.join(outputFolder, "preflight-0011.sql"), "utf8"));
      const apply = executableSql(await readFile(path.join(outputFolder, "apply-0012-through-0014.sql"), "utf8"));
      const postflight = executableSql(await readFile(path.join(outputFolder, "postflight-0014.sql"), "utf8"));

      await expect(pool.query(preflight)).resolves.toBeDefined();
      await pool.query("BEGIN; UPDATE drizzle.__drizzle_migrations SET hash='wrong' WHERE id=(SELECT min(id) FROM drizzle.__drizzle_migrations)");
      await expect(pool.query(preflight.replace(/^BEGIN;\n/, ""))).rejects.toThrow("ledger is not exactly");
      await pool.query("ROLLBACK");
      await pool.query("BEGIN; DELETE FROM drizzle.__drizzle_migrations WHERE id=(SELECT max(id) FROM drizzle.__drizzle_migrations)");
      await expect(pool.query(preflight.replace(/^BEGIN;\n/, ""))).rejects.toThrow("ledger is not exactly");
      await pool.query("ROLLBACK");
      await pool.query("BEGIN; INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ('extra',9999999999999)");
      await expect(pool.query(preflight.replace(/^BEGIN;\n/, ""))).rejects.toThrow("ledger is not exactly");
      await pool.query("ROLLBACK");

      const replaceInheritedFk = `ALTER TABLE appointments DROP CONSTRAINT appointments_employee_workspace_fk;
        ALTER TABLE appointments ADD CONSTRAINT appointments_employee_workspace_fk
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL`;
      await pool.query(`BEGIN; ${replaceInheritedFk}`);
      await expect(pool.query(preflight.replace(/^BEGIN;\n/, "")))
        .rejects.toThrow("appointments.appointments_employee_workspace_fk");
      await pool.query("ROLLBACK");

      const forcedFailureApply = apply.replace(
        "CREATE TEMP TABLE expected_0014_ledger",
        `${replaceInheritedFk};\nCREATE TEMP TABLE expected_0014_ledger`,
      );
      await expect(pool.query(forcedFailureApply)).rejects.toThrow("appointments.appointments_employee_workspace_fk");
      expect((await pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(12);
      expect((await pool.query("SELECT to_regclass('public.calcom_connections') AS connections, to_regclass('public.calcom_webhook_receipts') AS receipts, to_regclass('public.retell_function_invocations') AS invocations, to_regclass('public.calcom_oauth_states') AS oauth_states")).rows[0])
        .toEqual({ connections: null, receipts: null, invocations: null, oauth_states: null });
      expect((await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='workspace_members' AND column_name='employee_id') OR (table_name='calcom_connections' AND column_name IN ('credential_version','lifecycle_generation','lifecycle_lease_expires_at','credential_refresh_lease_expires_at','event_type_id','webhook_id','destination_calendar_integration','destination_calendar_external_id')))" )).rows).toEqual([]);
      expect((await pool.query("SELECT regexp_replace(lower(pg_get_constraintdef(oid,true)),'[[:space:]]+',' ','g') AS definition FROM pg_constraint WHERE conrelid='public.appointments'::regclass AND conname='appointments_employee_workspace_fk'")).rows[0].definition)
        .toBe("foreign key (agent_id, employee_id) references employees(agent_id, id)");

      await pool.query(apply);
      await expect(pool.query(postflight)).resolves.toBeDefined();

      await pool.query(`BEGIN; ${replaceInheritedFk}`);
      await expect(pool.query(postflight.replace(/^BEGIN;\n/, "")))
        .rejects.toThrow("appointments.appointments_employee_workspace_fk");
      await pool.query("ROLLBACK");

      const { rows: [agent] } = await pool.query("INSERT INTO agents (business_name,timezone) VALUES ('RLS fixture','UTC') RETURNING id");
      await pool.query("INSERT INTO workspaces VALUES ($1,'rollout-owner','team')", [agent.id]);
      const { rows: [employee] } = await pool.query("INSERT INTO employees (agent_id,display_name,timezone) VALUES ($1,'RLS employee','UTC') RETURNING id", [agent.id]);
      const { rows: [connection] } = await pool.query("INSERT INTO calcom_connections (agent_id,employee_id,encrypted_credential,provider_user_id,account_email,display_label) VALUES ($1,$2,'opaque','rls-provider','rls@example.test','RLS') RETURNING id", [agent.id, employee.id]);
      await pool.query("INSERT INTO calcom_webhook_receipts (connection_id,digest,booking_uid,event_type) VALUES ($1,'rls-digest','rls-uid','BOOKING_CREATED')", [connection.id]);
      await pool.query("INSERT INTO retell_function_invocations (key,agent_id,call_id,name,semantic_hash) VALUES ($1,$2,'rls-call','save-message',$3)", ["a".repeat(64), agent.id, "b".repeat(64)]);
      await pool.query("INSERT INTO calcom_oauth_states (state_hash,agent_id,user_id,employee_id,intent,browser_challenge_hash,expires_at) VALUES ($1,$2,'rollout-owner',$3,'connect',$4,now()+interval '10 minutes')", ["c".repeat(64), agent.id, employee.id, "d".repeat(64)]);
      const deniedInserts: Record<string, () => Promise<unknown>> = {
        calcom_connections: () => pool.query("INSERT INTO calcom_connections (agent_id,employee_id,encrypted_credential,provider_user_id,account_email,display_label) VALUES ($1,$2,'denied','denied-provider','denied@example.test','Denied')", [agent.id, employee.id]),
        calcom_webhook_receipts: () => pool.query("INSERT INTO calcom_webhook_receipts (connection_id,digest,booking_uid,event_type) VALUES ($1,'denied','denied','BOOKING_CREATED')", [connection.id]),
        retell_function_invocations: () => pool.query("INSERT INTO retell_function_invocations (key,agent_id,call_id,name,semantic_hash) VALUES ($1,$2,'denied','save-message',$3)", ["e".repeat(64), agent.id, "f".repeat(64)]),
        calcom_oauth_states: () => pool.query("INSERT INTO calcom_oauth_states (state_hash,agent_id,user_id,employee_id,intent,browser_challenge_hash,expires_at) VALUES ($1,$2,'rollout-owner',$3,'connect',$4,now()+interval '10 minutes')", ["1".repeat(64), agent.id, employee.id, "2".repeat(64)]),
      };
      for (const [table, deniedInsert] of Object.entries(deniedInserts)) {
        await pool.query("BEGIN");
        try {
          await pool.query("CREATE ROLE rollout_non_owner NOLOGIN");
          await pool.query(`GRANT USAGE ON SCHEMA public TO rollout_non_owner; GRANT SELECT,INSERT ON ${table} TO rollout_non_owner; SET LOCAL ROLE rollout_non_owner`);
          expect((await pool.query(`SELECT * FROM ${table}`)).rows, table).toEqual([]);
          await expect(deniedInsert(), table).rejects.toMatchObject({ code: "42501" });
        } finally {
          await pool.query("ROLLBACK");
        }
      }

      const ledger = (await pool.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
      expect(ledger).toHaveLength(15);
      expect(ledger.slice(12)).toEqual([
        { hash: "2b30be229b9e9d5838a487eafce6124a6a7868aaee4f0381da560ba1a0e6a7bf", created_at: "1789376911440" },
        { hash: "8bf317f4b3b538fc41a5e3cc2b83f2ff110c0d6b3f4efb28e7e5ed6a55d3433c", created_at: "1789378995620" },
        { hash: "8d3d239749a4dd26d2280145cbe7c93596dcffd4d98c6fa524ee3aa9c234e7dc", created_at: "1789455668817" },
      ]);
      expect((await pool.query("SELECT to_regclass('public.calcom_connections') AS calcom, to_regclass('public.retell_function_invocations') AS retell, to_regclass('public.calcom_oauth_states') AS oauth")).rows[0])
        .toEqual({ calcom: "calcom_connections", retell: "retell_function_invocations", oauth: "calcom_oauth_states" });
    } finally {
      await pool.end();
    }
  }, 60_000);
});
