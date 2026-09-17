import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = path.join(ROOT, "scripts/generate-0011-to-0014-rollout.mjs");
const MIGRATIONS = path.join(ROOT, "packages/core/drizzle");
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function copyMigrations(destination: string) {
  await mkdir(path.join(destination, "meta"));
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS, "meta/_journal.json"), "utf8"));
  await Promise.all(journal.entries.map((entry: { tag: string }) =>
    copyFile(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(destination, `${entry.tag}.sql`))));
  await copyFile(path.join(MIGRATIONS, "meta/_journal.json"), path.join(destination, "meta/_journal.json"));
}

function generate(outputDirectory: string, migrationsDirectory = MIGRATIONS) {
  return spawnSync(process.execPath, [SCRIPT, "--migrations-dir", migrationsDirectory, "--output-dir", outputDirectory], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("0011 to 0014 rollout generator", () => {
  it("binds the executable artifacts to the reviewed migration bytes and journal", async () => {
    const outputDirectory = await temporaryDirectory("deskroute-rollout-output-");
    const result = generate(outputDirectory);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("2b30be229b9e9d5838a487eafce6124a6a7868aaee4f0381da560ba1a0e6a7bf");
    expect(result.stdout).not.toContain("5560");
    const files = await Promise.all([
      "preflight-0011.sql",
      "apply-0012-through-0014.sql",
      "postflight-0014.sql",
      "migration-manifest.sha256",
      "rollout-artifacts.sha256",
    ].map((name) => readFile(path.join(outputDirectory, name), "utf8")));
    expect(files[1]).toContain("INSERT INTO drizzle.__drizzle_migrations (hash, created_at)");
    expect(files[1]).toContain("0013_retell_function_invocations");
    expect(files[2]).toContain("calcom_oauth_states");
    expect(files[2]).toContain("connamespace = 'public'::regnamespace");
    expect(files[2]).toContain("convalidated");
    expect(files[2]).toContain("pg_get_constraintdef");
    expect(files[2]).toContain("foreign key (agent_id, employee_id) references employees(agent_id, id) on delete cascade");
    for (const line of files[4].trim().split("\n")) {
      const [checksum, name] = line.split(/  /);
      const bytes = await readFile(path.join(outputDirectory, name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(checksum);
    }
  });

  it("refuses a journal whose exact bytes differ despite identical parsed metadata", async () => {
    const migrationsDirectory = await temporaryDirectory("deskroute-rollout-migrations-");
    const outputDirectory = await temporaryDirectory("deskroute-rollout-output-");
    await copyMigrations(migrationsDirectory);
    const journalPath = path.join(migrationsDirectory, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    await writeFile(journalPath, `${JSON.stringify(journal)}\n`);

    const result = generate(outputDirectory, migrationsDirectory);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Migration journal checksum mismatch");
  });

  it("refuses a migration whose exact bytes do not match the reviewed checksum", async () => {
    const migrationsDirectory = await temporaryDirectory("deskroute-rollout-migrations-");
    const outputDirectory = await temporaryDirectory("deskroute-rollout-output-");
    await copyMigrations(migrationsDirectory);
    const migration = path.join(migrationsDirectory, "0012_calcom_integration.sql");
    await writeFile(migration, `${await readFile(migration, "utf8")}\n-- changed\n`);

    const result = generate(outputDirectory, migrationsDirectory);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Checksum mismatch for 0012_calcom_integration");
  });
});
