import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { transferRequests as transfers, workspaceMembers as members } from "../db/schema.js";

export async function transferDirectory(agentId: string) {
  return db.select({ userId: members.userId, name: members.displayName, department: members.department })
    .from(members).where(and(eq(members.agentId, agentId), eq(members.available, true)));
}
export async function requestBrowserTransfer(agentId: string, roomName: string, callerIdentity: string, targetUserId: string) {
  const target = (await transferDirectory(agentId)).find(item => item.userId === targetUserId && item.name);
  if (!target) return { error: "That teammate is unavailable. Offer to take a message." };
  const expiresAt = new Date(Date.now() + 90_000);
  const [request] = await db.insert(transfers).values({ agentId, roomName, callerIdentity, targetUserId, expiresAt })
    .onConflictDoNothing().returning({ id: transfers.id });
  if (!request) return { error: "A transfer was already requested for this test call. Continue helping or start a new test." };
  return { requested: true, name: target.name, expiresInSeconds: 90, instructions: "The teammate must accept in their browser. Do not claim the call has transferred yet. Continue helping if they do not join." };
}
export async function transferInbox(agentId: string, userId: string) {
  return db.select({ id: transfers.id, status: transfers.status, expiresAt: transfers.expiresAt })
    .from(transfers).where(and(eq(transfers.agentId, agentId), eq(transfers.targetUserId, userId),
      inArray(transfers.status, ["pending", "accepted"]), gt(transfers.expiresAt, new Date())));
}
export async function respondToTransfer(agentId: string, userId: string, id: string, accept: boolean) {
  const available = (await transferDirectory(agentId)).some(item => item.userId === userId);
  if (accept && !available) return null;
  const [row] = await db.update(transfers).set({ status: accept ? "accepted" : "declined" })
    .where(and(eq(transfers.agentId, agentId), eq(transfers.targetUserId, userId), eq(transfers.id, id),
      inArray(transfers.status, accept ? ["pending", "accepted"] : ["pending"]), gt(transfers.expiresAt, new Date()))).returning();
  return row ?? null;
}
export async function connectTransfer(agentId: string, roomName: string, id: string, userId: string) {
  const available = (await transferDirectory(agentId)).some(item => item.userId === userId);
  if (!available) return false;
  const rows = await db.update(transfers).set({ status: "connected" }).where(and(eq(transfers.agentId, agentId),
    eq(transfers.roomName, roomName), eq(transfers.id, id), eq(transfers.targetUserId, userId),
    eq(transfers.status, "accepted"), gt(transfers.expiresAt, new Date()))).returning();
  return rows.length > 0;
}
export async function endTransfer(agentId: string, roomName: string) {
  await db.update(transfers).set({ status: "ended" }).where(and(eq(transfers.agentId, agentId), eq(transfers.roomName, roomName)));
}
