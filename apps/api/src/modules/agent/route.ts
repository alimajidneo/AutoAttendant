import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { AccessToken } from "livekit-server-sdk";
import { RoomConfiguration, RoomAgentDispatch } from "@livekit/protocol";
import type { AppEnv } from "../../types.js";
import { livekitConfig } from "@receptionist/core/env.js";

/**
 * The token carries `agentId` and `testSession`, so the worker resolves the
 * agent as it would for a SIP call while skipping recording and the call row.
 */
export const agent = new Hono<AppEnv>().post("/test", async (c) => {
  const livekit = livekitConfig();
  if (!livekit) return c.json({ error: "LiveKit is not configured" }, 503);
  const agentId = c.get("agentId");
  const roomName = `test-${agentId}-${randomUUID()}`;

  const at = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity: `admin-${agentId}`,
    name: "Admin (Test)",
    attributes: { agentId, testSession: "true" },
    ttl: "10m",
  });

  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canUpdateOwnMetadata: false });
  at.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: "receptionist" })],
  });

  return c.json({ serverUrl: livekit.url, token: await at.toJwt(), roomName });
});
