import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types.js";
import { listNotifications, markNotificationsRead } from "@receptionist/core/repositories/notifications.js";

const readSchema = z.object({
  items: z.array(z.object({
    id: z.string().regex(/^(?:appointment:[0-9a-f-]{36}:(?:confirmed|requested|cancelled)|(?:question|call):[0-9a-f-]{36})$/i),
    occurredAt: z.string().datetime({ offset: true }),
  }).strict()).min(1).max(50),
}).strict();

export const notifications = new Hono<AppEnv>()
  .get("/", async c => c.json(await listNotifications(c.get("agentId"), c.get("authUser").id)))
  .post("/read", async c => {
    const parsed = readSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Choose up to 50 valid notifications" }, 400);
    await markNotificationsRead(c.get("agentId"), c.get("authUser").id, parsed.data.items);
    return c.json({ saved: true });
  });
