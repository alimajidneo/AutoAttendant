import { createMiddleware } from "hono/factory";
import { supabase } from "@receptionist/core/providers/supabase.js";
import { resolveAgentByAuthUserId } from "@receptionist/core/repositories/agents.js";
import type { AppEnv } from "../types.js";

export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
  const { data, error } = await supabase.auth.getUser(authorization.slice(7));
  if (error || !data.user || data.user.is_anonymous) return c.json({ error: "Unauthorized" }, 401);
  c.set("authUser", data.user);
  await next();
});

export const requireAgent = createMiddleware<AppEnv>(async (c, next) => {
  const agent = await resolveAgentByAuthUserId(c.get("authUser").id);
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  c.set("agentId", agent.id);
  await next();
});
