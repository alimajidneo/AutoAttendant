import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { employees, calendarConnections, workspaceMembers } from "../src/db/schema.js";
import * as repo from "../src/repositories/employees.js";
import { createWorkspace } from "../src/repositories/workspaces.js";
import { getCalendarConnection, listCalendarConnections, saveCalendarConnection } from "../src/repositories/calendar-connections.js";
import { env } from "../src/env.js";
const originalKey = env.TOKEN_ENCRYPTION_KEY;
afterAll(() => { env.TOKEN_ENCRYPTION_KEY = originalKey; });
beforeAll(() => { env.TOKEN_ENCRYPTION_KEY = "12".repeat(32); });
const draft = { displayName: "Sam", timezone: "UTC" };
async function workspace(owner = "owner") { return (await createWorkspace(owner, `${owner}@example.test`, "Test", "UTC", "team"))!.id; }
async function connection(agentId: string, provider: "google" | "microsoft" = "google") {
  return saveCalendarConnection({ id: crypto.randomUUID(), agentId, provider, providerAccountId: crypto.randomUUID(), accountEmail: "sam@example.test", accountName: "Sam", encryptedRefreshToken: "original-credential", encryptionOwner: "original-owner" });
}
describe("employee foundation", () => {
  it("creates an independent employee, bounds lists and scopes updates and deactivation", async () => {
    const a = await workspace(), b = await workspace("other");
    const employee = (await repo.createEmployee(a, draft))!;
    expect(await db.select().from(workspaceMembers)).toHaveLength(2);
    expect(await repo.listEmployees(b)).toEqual([]);
    expect(await repo.updateEmployee(b, employee.id, { displayName: "Wrong" })).toBeNull();
    expect(await repo.deactivateEmployee(b, employee.id)).toBeNull();
    expect(await repo.updateEmployee(a, employee.id, { department: "Sales", routingEnabled: true })).toMatchObject({ department: "Sales", routingEnabled: true });
    expect(await repo.deactivateEmployee(a, employee.id)).toMatchObject({ routingEnabled: false, manualAvailability: "unavailable" });
    expect(await repo.listEmployees(a, 1)).toHaveLength(1);
    expect(await repo.listEmployees(a, 0)).toHaveLength(1);
  });
  it("encrypts private numbers, returns only a mask, resolves internally and supports replacement/removal", async () => {
    const a = await workspace(), b = await workspace("other");
    const number = "+14155550123";
    const employee = (await repo.createEmployee(a, { ...draft, transferNumber: number }))!;
    const [raw] = await db.select().from(employees);
    expect(raw!.encryptedTransferDestination).toBeTruthy();
    expect(JSON.stringify(raw)).not.toContain(number);
    expect(employee).toMatchObject({ hasTransferDestination: true, transferDestinationDisplay: "•••• 0123" });
    expect(JSON.stringify(await repo.listEmployees(a))).not.toContain(raw!.encryptedTransferDestination!);
    expect(JSON.stringify(employee)).not.toContain(number);
    expect(await repo.resolveEmployeeTransferDestination(b, employee.id)).toBeNull();
    expect(await repo.resolveEmployeeTransferDestination(a, employee.id)).toBe(number);
    await repo.updateEmployee(a, employee.id, { transferNumber: "+442079460123" });
    expect(await repo.resolveEmployeeTransferDestination(a, employee.id)).toBe("+442079460123");
    expect(await repo.updateEmployee(a, employee.id, { transferNumber: null })).toMatchObject({ hasTransferDestination: false, transferDestinationDisplay: null });
    expect(await repo.resolveEmployeeTransferDestination(a, employee.id)).toBeNull();
  });
  it("assigns only same-workspace accounts without changing credentials or workspace calendar access", async () => {
    const a = await workspace(), b = await workspace("other");
    const e = (await repo.createEmployee(a, draft))!, other = (await repo.createEmployee(b, draft))!;
    const c = await connection(a), foreign = await connection(b);
    expect(c.employeeId).toBeNull();
    expect(await repo.assignEmployeeConnection(a, e.id, foreign.id, true)).toBe(false);
    expect(await repo.assignEmployeeConnection(a, other.id, c.id, true)).toBe(false);
    expect(await repo.assignEmployeeConnection(a, e.id, c.id, true)).toBe(true);
    expect(await getCalendarConnection(a, c.id)).toMatchObject({ employeeId: e.id, encryptedRefreshToken: "original-credential", encryptionOwner: "original-owner" });
    expect(await listCalendarConnections(a)).toHaveLength(1);
    expect(await repo.listEmployeeConnections(a)).toEqual([expect.objectContaining({ id: c.id, employeeId: e.id, provider: "google" })]);
    expect(JSON.stringify(await repo.listEmployeeConnections(a))).not.toContain("original-credential");
    expect(await repo.assignEmployeeConnection(a, e.id, c.id, false)).toBe(true);
    expect((await getCalendarConnection(a, c.id))!.employeeId).toBeNull();
  });
  it("validates direct references against assigned accounts and clears policies on unassignment", async () => {
    const a = await workspace(), b = await workspace("other");
    const e = (await repo.createEmployee(a, draft))!, second = (await repo.createEmployee(a, draft))!;
    const c = await connection(a, "microsoft");
    const policy = { authority: "direct" as const, booking: { connectionId: c.id, calendarId: "primary" }, conflicts: [{ connectionId: c.id, calendarId: "private" }] };
    expect(await repo.saveEmployeePolicy(a, e.id, policy)).toBeNull();
    await repo.assignEmployeeConnection(a, e.id, c.id, true);
    expect(await repo.saveEmployeePolicy(b, e.id, policy)).toBeNull();
    expect(await repo.saveEmployeePolicy(a, e.id, policy)).toMatchObject({ calendarPolicy: policy });
    expect(await repo.assignEmployeeConnection(a, second.id, c.id, true)).toBe(false);
    expect(await repo.assignEmployeeConnection(a, second.id, c.id, false)).toBe(false);
    await repo.assignEmployeeConnection(a, e.id, c.id, false);
    expect((await repo.listEmployees(a)).find(x => x.id === e.id)!.calendarPolicy).toEqual({ authority: "direct", booking: null, conflicts: [] });
    const cal = { authority: "calcom" as const, eventType: "sam/intro", bookingUrl: "https://cal.com/sam/intro" };
    expect(await repo.saveEmployeePolicy(a, e.id, cal)).toMatchObject({ calendarPolicy: cal });
  });
  it("caps employee lists at 100 and pages deterministically", async () => {
    const a = await workspace();
    await db.insert(employees).values(Array.from({ length: 105 }, (_, i) => ({ agentId: a, displayName: `Employee ${String(i).padStart(3, "0")}`, timezone: "UTC" })));
    expect(await repo.listEmployees(a, 1000)).toHaveLength(100);
    expect(await repo.listEmployees(a, 20, 100)).toHaveLength(5);
    expect((await repo.listEmployees(a, 1, 1))[0]!.displayName).toBe("Employee 001");
  });
  it("binds encryption to the employee and fails closed without a key", async () => {
    const a = await workspace();
    const first = await repo.createEmployee(a, { ...draft, transferNumber: "+14155550123" });
    const second = await repo.createEmployee(a, draft);
    const [raw] = await db.select().from(employees).where(eq(employees.id, first.id));
    await db.update(employees).set({ encryptedTransferDestination: raw!.encryptedTransferDestination }).where(eq(employees.id, second.id));
    await expect(repo.resolveEmployeeTransferDestination(a, second.id)).rejects.toThrow();
    env.TOKEN_ENCRYPTION_KEY = undefined;
    try {
      await expect(repo.createEmployee(a, { ...draft, transferNumber: "+14155550123" })).rejects.toThrow("Transfer encryption is not configured");
      await expect(repo.resolveEmployeeTransferDestination(a, first.id)).rejects.toThrow("Transfer encryption is not configured");
      expect(await repo.listEmployees(a)).toHaveLength(2);
    } finally { env.TOKEN_ENCRYPTION_KEY = "12".repeat(32); }
  });
  it("denies direct table reads and writes to a client role even when SQL privileges are granted", async () => {
    const a = await workspace();
    await repo.createEmployee(a, draft);
    await expect(db.transaction(async tx => {
      await tx.execute(sql`CREATE ROLE employee_rls_test NOLOGIN`);
      await tx.execute(sql`GRANT USAGE ON SCHEMA public TO employee_rls_test`);
      await tx.execute(sql`GRANT SELECT, INSERT ON employees TO employee_rls_test`);
      await tx.execute(sql`SET LOCAL ROLE employee_rls_test`);
      expect((await tx.execute(sql`SELECT * FROM employees`)).rows).toEqual([]);
      await tx.execute(sql`INSERT INTO employees (agent_id, display_name, timezone) VALUES (${a}, 'Denied', 'UTC')`);
    })).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });
    expect(await repo.listEmployees(a)).toHaveLength(1);
  });
  it("enables deny-by-default RLS and rejects cross-workspace foreign keys", async () => {
    const a = await workspace(), b = await workspace("other");
    const e = (await repo.createEmployee(a, draft))!, c = await connection(b);
    expect((await db.execute(sql`select relrowsecurity from pg_class where oid = 'employees'::regclass`)).rows).toEqual([{ relrowsecurity: true }]);
    expect((await db.execute(sql`select * from pg_policies where tablename = 'employees'`)).rows).toEqual([]);
    await expect(db.update(calendarConnections).set({ employeeId: e.id }).where(eq(calendarConnections.id, c.id))).rejects.toThrow();
  });
});

it('keeps an assigned account on disconnect and bounds normalized routing lookup', async () => {
  const { deleteCalendarConnection } = await import('../src/repositories/calendar-connections.js');
  const a = await workspace();
  const employee = await repo.createEmployee(a, { displayName: '  Sam   Jones  ', department: 'Sales', timezone: 'UTC', routingEnabled: true });
  const c = await connection(a);
  await repo.assignEmployeeConnection(a, employee.id, c.id, true);
  expect(await deleteCalendarConnection(a, c.id)).toBe(false);
  expect(await getCalendarConnection(a, c.id)).toBeTruthy();
  expect(await repo.lookupEmployees(a, { name: 'sam jones', department: ' sales ' })).toEqual([{ id: employee.id, name: '  Sam   Jones  ', department: 'Sales', calendarAuthority: 'direct' }]);
  for (let i = 0; i < 12; i++) await repo.createEmployee(a, { displayName: 'Candidate', timezone: 'UTC', routingEnabled: true });
  expect(await repo.lookupEmployees(a, {})).toHaveLength(10);
  expect(await repo.lookupEmployees(await workspace('foreign'), {})).toEqual([]);
  await repo.assignEmployeeConnection(a, employee.id, c.id, false);
  expect(await deleteCalendarConnection(a, c.id)).toBe(true);
});
