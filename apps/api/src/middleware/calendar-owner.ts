import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types.js";

export const requireCalendarOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("workspaceOwner")) return c.json({ error: "The workspace owner manages private calendar connections" }, 403);
  await next();
});
