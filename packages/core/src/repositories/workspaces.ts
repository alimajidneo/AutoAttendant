import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { agents, workspaces, workspaceMembers as members, workspaceInvites as invites } from "../db/schema.js";

export async function listWorkspaces(userId: string) {
  return db.select({ id: workspaces.agentId, name: agents.businessName, kind: workspaces.kind,
    ownerUserId: workspaces.ownerUserId, role: members.role, userId: members.userId })
    .from(members).innerJoin(workspaces, eq(members.agentId, workspaces.agentId))
    .innerJoin(agents, eq(agents.id, workspaces.agentId)).where(eq(members.userId, userId)).orderBy(agents.createdAt);
}

export async function workspaceAccess(agentId: string, userId: string) {
  const [row] = await db.select({ role: members.role, ownerUserId: workspaces.ownerUserId, kind: workspaces.kind })
    .from(members).innerJoin(workspaces, eq(workspaces.agentId, members.agentId))
    .where(and(eq(members.agentId, agentId), eq(members.userId, userId)));
  return row ?? null;
}

export async function createWorkspace(userId: string, name: string, timezone: string, kind: "personal" | "team") {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const owned = await tx.select().from(workspaces).where(eq(workspaces.ownerUserId, userId));
    if (owned.length >= 10) return null;
    const [agent] = await tx.insert(agents).values({ businessName: name, timezone }).returning({ id: agents.id });
    await tx.insert(workspaces).values({ agentId: agent!.id, ownerUserId: userId, kind });
    await tx.insert(members).values({ agentId: agent!.id, userId, role: "manager" });
    return agent!;
  });
}

export async function listMembers(agentId: string) {
  return db.select().from(members).where(eq(members.agentId, agentId)).orderBy(members.displayName, members.userId);
}

export async function updateMember(agentId: string, actor: string, target: string,
  patch: Partial<Pick<typeof members.$inferInsert, "displayName" | "department" | "available" | "role">>) {
  return db.transaction(async tx => {
    const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.agentId, agentId)).for("update");
    if (!workspace) return false;
    const [access] = await tx.select().from(members).where(and(eq(members.agentId, agentId), eq(members.userId, actor)));
    if (!access || (actor !== target && access.role !== "manager")) return false;
    if (patch.role !== undefined && (workspace.ownerUserId !== actor || target === workspace.ownerUserId)) return false;
    const updated = await tx.update(members).set(patch).where(and(eq(members.agentId, agentId), eq(members.userId, target))).returning();
    return updated.length > 0;
  });
}

export async function removeMember(agentId: string, actor: string, target: string) {
  return db.transaction(async tx => {
    const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.agentId, agentId)).for("update");
    if (!workspace || workspace.ownerUserId !== actor || target === actor) return false;
    await tx.delete(members).where(and(eq(members.agentId, agentId), eq(members.userId, target)));
    return true;
  });
}

const hash = (code: string) => createHash("sha256").update(code).digest("hex");
export async function createInvite(agentId: string, actor: string, email: string, role: "manager" | "member") {
  const access = await workspaceAccess(agentId, actor);
  if (!access || access.ownerUserId !== actor || access.kind !== "team") return null;
  const code = randomBytes(32).toString("base64url");
  const [invite] = await db.insert(invites).values({ agentId, email: email.toLowerCase(), role,
    tokenHash: hash(code), expiresAt: new Date(Date.now() + 7 * 86400_000) }).returning({ id: invites.id, expiresAt: invites.expiresAt });
  return { ...invite!, code };
}
export async function listInvites(agentId: string) {
  return db.select({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt })
    .from(invites).where(and(eq(invites.agentId, agentId), isNull(invites.consumedAt), gt(invites.expiresAt, new Date())));
}
export async function revokeInvite(agentId: string, actor: string, id: string) {
  const access = await workspaceAccess(agentId, actor);
  if (access?.ownerUserId !== actor) return false;
  await db.update(invites).set({ consumedAt: new Date() }).where(and(eq(invites.agentId, agentId), eq(invites.id, id)));
  return true;
}
export async function acceptInvite(userId: string, verifiedEmail: string, code: string) {
  return db.transaction(async tx => {
    const [invite] = await tx.select().from(invites).where(and(eq(invites.tokenHash, hash(code)),
      eq(invites.email, verifiedEmail.toLowerCase()), isNull(invites.consumedAt), gt(invites.expiresAt, new Date()))).for("update");
    if (!invite) return null;
    await tx.insert(members).values({ agentId: invite.agentId, userId, role: invite.role }).onConflictDoNothing();
    await tx.update(invites).set({ consumedAt: new Date() }).where(eq(invites.id, invite.id));
    return { id: invite.agentId };
  });
}
