import { Hono } from "hono";
import { z } from "zod";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { env } from "@receptionist/core/env.js";
import { transferInbox, respondToTransfer } from "@receptionist/core/repositories/transfers.js";
import { authenticate, requireAgent } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";

export const transfers = new Hono<AppEnv>()
  .use("*", authenticate, requireAgent)
  .get("/", async c => c.json(await transferInbox(c.get("agentId"), c.get("authUser").id)))
  .post("/:id/respond", async c => {
    const parsed = z.object({ accept: z.boolean() }).strict().safeParse(await c.req.json());
    if (!parsed.success || !z.string().uuid().safeParse(c.req.param("id")).success) return c.json({ error: "Invalid transfer response" }, 400);
    const userId = c.get("authUser").id;
    const row = await respondToTransfer(c.get("agentId"), userId, c.req.param("id"), parsed.data.accept);
    if (!row) return c.json({ error: "This request expired or you are unavailable" }, 409);
    if (!parsed.data.accept) return c.json({ declined: true });
    const rooms = new RoomServiceClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    const participants = await rooms.listParticipants(row.roomName);
    if (!participants.some(item => item.identity === row.callerIdentity)) return c.json({ error: "The caller has left" }, 409);
    const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: `transfer-${row.id}`, name: "Teammate", ttl: "90s",
      attributes: { transferRequestId: row.id, transferUserId: userId },
    });
    token.addGrant({ roomJoin: true, room: row.roomName, canPublish: true, canSubscribe: true,
      canPublishData: false, canUpdateOwnMetadata: false });
    return c.json({ serverUrl: env.LIVEKIT_URL, token: await token.toJwt(), roomName: row.roomName });
  });
