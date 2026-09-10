import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types.js";

export const requireWorkspaceOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("workspaceOwner")) return c.json({ error: "The workspace owner manages external connections" }, 403);
  await next();
});

export const requireCalendarOwner = requireWorkspaceOwner;
