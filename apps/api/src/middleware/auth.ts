import { createMiddleware } from "hono/factory";
import { supabase } from "@receptionist/core/providers/supabase.js";
import { listWorkspaces, workspaceAccess } from "@receptionist/core/repositories/workspaces.js";
import { z } from "zod";
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
  const userId = c.get("authUser").id;
  const selected = c.req.header("X-Workspace-Id");
  if (selected && !z.string().uuid().safeParse(selected).success) return c.json({ error: "Invalid workspace" }, 400);
  const agentId = selected ?? (await listWorkspaces(userId))[0]?.id;
  if (!agentId) return c.json({ error: "Create or join a workspace first" }, 404);
  const access = await workspaceAccess(agentId, userId);
  if (!access) return c.json({ error: "Workspace access denied" }, 403);
  c.set("agentId", agentId);
  c.set("workspaceRole", access.role);
  c.set("workspaceOwner", access.ownerUserId === userId);
  await next();
});

export const requireManager = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("workspaceRole") !== "manager") return c.json({ error: "Manager access required" }, 403);
  await next();
});
