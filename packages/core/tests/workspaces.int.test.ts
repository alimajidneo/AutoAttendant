import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { workspaceInvites, workspaceMembers, transferRequests } from "../src/db/schema.js";
import { createAgent } from "../src/repositories/agents.js";
import { createWorkspace, listWorkspaces, workspaceAccess, createInvite, acceptInvite, updateMember, removeMember, revokeInvite } from "../src/repositories/workspaces.js";
import { requestBrowserTransfer, respondToTransfer, transferInbox, connectTransfer } from "../src/repositories/transfers.js";
import { listNotifications, markNotificationsRead } from "../src/repositories/notifications.js";
import { makeAppointment } from "./factories.js";

async function team() {
  const workspace = (await createWorkspace("owner", "Team", "America/New_York", "team"))!;
  const invite = (await createInvite(workspace.id, "owner", "member@example.test", "member"))!;
  await acceptInvite("member", "member@example.test", invite.code);
  return workspace;
}
describe("workspace boundaries", () => {
  it("preserves personal onboarding and isolates a new shared workspace", async () => {
    const personal = await createAgent({ authUserId: "owner", businessName: "Personal", industry: "", timezone: "UTC" });
    const shared = await team();
    expect((await listWorkspaces("owner")).map(x => x.id)).toEqual([personal.id, shared.id]);
    expect((await listWorkspaces("member")).map(x => x.id)).toEqual([shared.id]);
    expect(await workspaceAccess(personal.id, "member")).toBeNull();
    expect(await createInvite(personal.id, "owner", "new@example.test", "member")).toBeNull();
  });
  it("binds a single-use invitation to its email and stores only its hash", async () => {
    const workspace = (await createWorkspace("owner", "Team", "UTC", "team"))!;
    const invite = (await createInvite(workspace.id, "owner", "Person@example.test", "manager"))!;
    const [row] = await db.select().from(workspaceInvites);
    expect(JSON.stringify(row)).not.toContain(invite.code);
    expect(await acceptInvite("attacker", "wrong@example.test", invite.code)).toBeNull();
    const results = await Promise.all([acceptInvite("person", "person@example.test", invite.code), acceptInvite("person", "person@example.test", invite.code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await workspaceAccess(workspace.id, "person"))?.role).toBe("manager");
  });
  it("rejects expired, revoked and member-created invitations", async () => {
    const workspace = await team();
    expect(await createInvite(workspace.id, "member", "new@example.test", "manager")).toBeNull();
    const expired = (await createInvite(workspace.id, "owner", "new@example.test", "member"))!;
    await db.update(workspaceInvites).set({ expiresAt: new Date(0) }).where(eq(workspaceInvites.id, expired.id));
    expect(await acceptInvite("new", "new@example.test", expired.code)).toBeNull();
    const revoked = (await createInvite(workspace.id, "owner", "new@example.test", "member"))!;
    expect(await revokeInvite(workspace.id, "member", revoked.id)).toBe(false);
    expect(await revokeInvite(workspace.id, "owner", revoked.id)).toBe(true);
    expect(await acceptInvite("new", "new@example.test", revoked.code)).toBeNull();
  });
  it("permits self configuration, protects roles and owner membership, and revokes access", async () => {
    const workspace = await team();
    expect(await updateMember(workspace.id, "member", "member", { displayName: "Sam", department: "Sales", available: true })).toBe(true);
    expect(await updateMember(workspace.id, "member", "member", { role: "manager" })).toBe(false);
    expect(await updateMember(workspace.id, "member", "owner", { available: true })).toBe(false);
    expect(await updateMember(workspace.id, "owner", "member", { role: "manager" })).toBe(true);
    expect(await updateMember(workspace.id, "member", "owner", { role: "member" })).toBe(false);
    expect(await removeMember(workspace.id, "owner", "owner")).toBe(false);
    expect(await removeMember(workspace.id, "owner", "member")).toBe(true);
    expect(await workspaceAccess(workspace.id, "member")).toBeNull();
  });
  it("keeps notification reads separate for managers", async () => {
    const workspace = await team();
    await makeAppointment(workspace.id);
    const [item] = await listNotifications(workspace.id, "owner");
    await markNotificationsRead(workspace.id, "owner", [item]);
    expect((await listNotifications(workspace.id, "owner"))[0].read).toBe(true);
    expect((await listNotifications(workspace.id, "member"))[0].read).toBe(false);
  });
  it("enables RLS on every new backend table", async () => {
    const result = await db.execute(sql`select relname, relrowsecurity from pg_class where relname in ('workspaces','workspace_members','workspace_invites','transfer_requests')`);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every(row => row.relrowsecurity)).toBe(true);
  });
});
describe("browser transfer boundaries", () => {
  it("routes only to an available workspace member and requires that member to accept", async () => {
    const workspace = await team();
    expect(await requestBrowserTransfer(workspace.id, "room", "caller", "member")).toHaveProperty("error");
    await updateMember(workspace.id, "member", "member", { displayName: "Sam", available: true });
    expect(await requestBrowserTransfer(workspace.id, "room", "caller", "stranger")).toHaveProperty("error");
    expect(await requestBrowserTransfer(workspace.id, "room", "caller", "member")).toHaveProperty("requested", true);
    expect(await requestBrowserTransfer(workspace.id, "room", "caller", "member")).toHaveProperty("error");
    const [request] = await transferInbox(workspace.id, "member");
    expect(await transferInbox(workspace.id, "owner")).toEqual([]);
    expect(await respondToTransfer(workspace.id, "owner", request.id, true)).toBeNull();
    expect(await connectTransfer(workspace.id, "room", request.id, "member")).toBe(false);
    expect(await respondToTransfer(workspace.id, "member", request.id, true)).toHaveProperty("status", "accepted");
    expect(await connectTransfer(workspace.id, "different-room", request.id, "member")).toBe(false);
    expect(await connectTransfer(workspace.id, "room", request.id, "member")).toBe(true);
    expect(await connectTransfer(workspace.id, "room", request.id, "member")).toBe(false);
  });
  it("rejects late acceptance and a removed recipient", async () => {
    const workspace = await team();
    await updateMember(workspace.id, "member", "member", { displayName: "Sam", available: true });
    await requestBrowserTransfer(workspace.id, "late-room", "caller", "member");
    const [request] = await transferInbox(workspace.id, "member");
    await db.update(transferRequests).set({ expiresAt: new Date(0) }).where(eq(transferRequests.id, request.id));
    expect(await respondToTransfer(workspace.id, "member", request.id, true)).toBeNull();
    await requestBrowserTransfer(workspace.id, "removed-room", "caller", "member");
    const [next] = await transferInbox(workspace.id, "member");
    await respondToTransfer(workspace.id, "member", next.id, true);
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, "member"));
    expect(await connectTransfer(workspace.id, "removed-room", next.id, "member")).toBe(false);
  });
});
