import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import type { SlackAlertKind } from "@receptionist/shared";
import { slackConnections } from "../db/schema.js";

export async function getSlackConnection(agentId: string) {
  const [row] = await db.select().from(slackConnections)
    .where(eq(slackConnections.agentId, agentId)).limit(1);
  return row ?? null;
}

export async function saveSlackConnection(input: {
  agentId: string;
  teamId: string;
  teamName: string;
  botUserId: string | null;
  encryptedBotToken: string;
  encryptionOwner: string;
}) {
  const [row] = await db.insert(slackConnections).values({ ...input, alertKinds: [], updatedAt: new Date() })
    .onConflictDoUpdate({
      target: slackConnections.agentId,
      set: {
        teamId: input.teamId,
        teamName: input.teamName,
        botUserId: input.botUserId,
        encryptedBotToken: input.encryptedBotToken,
        encryptionOwner: input.encryptionOwner,
        channelId: null,
        channelName: null,
        alertKinds: [],
        updatedAt: new Date(),
      },
    }).returning();
  return row!;
}

export async function updateSlackSettings(
  agentId: string,
  channel: { id: string; name: string },
  alertKinds: SlackAlertKind[],
) {
  const [row] = await db.update(slackConnections).set({
    channelId: channel.id,
    channelName: channel.name,
    alertKinds,
    updatedAt: new Date(),
  }).where(eq(slackConnections.agentId, agentId)).returning();
  return row ?? null;
}

export async function deleteSlackConnection(agentId: string) {
  await db.delete(slackConnections).where(eq(slackConnections.agentId, agentId));
}
