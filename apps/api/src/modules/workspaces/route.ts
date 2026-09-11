import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types.js";
import { authenticate } from "../../middleware/auth.js";
import * as repo from "@receptionist/core/repositories/workspaces.js";

const role = z.enum(["manager", "member"]);
const memberPatch = z.object({ displayName: z.string().trim().min(1).max(80).optional(),
  department: z.string().trim().max(80).optional(), available: z.boolean().optional(), role: role.optional() }).strict();
const creation = z.object({ name: z.string().trim().min(1).max(100), kind: z.enum(["personal", "team"]),
  timezone: z.string().refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }) }).strict();

export const workspaces = new Hono<AppEnv>()
  .use("*", authenticate)
  .get("/", async c => {
    const user = c.get("authUser");
    if (user.email && user.email_confirmed_at) await repo.saveVerifiedMemberEmail(user.id, user.email);
    return c.json(await repo.listWorkspaces(user.id));
  })
  .post("/", async c => {
    const parsed = creation.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Enter a workspace name and valid timezone" }, 400);
    const { name, timezone, kind } = parsed.data;
    const user = c.get("authUser");
    if (!user.email || !user.email_confirmed_at) return c.json({ error: "Verify your email before creating a workspace" }, 403);
    const result = await repo.createWorkspace(user.id, user.email, name, timezone, kind);
    return result ? c.json(result, 201) : c.json({ error: "Workspace limit reached" }, 409);
  })
  .post("/join", async c => {
    const user = c.get("authUser");
    if (!user.email || !user.email_confirmed_at) return c.json({ error: "Verify your email before accepting an invitation" }, 403);
    const parsed = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Enter a valid invitation code" }, 400);
    const result = await repo.acceptInvite(user.id, user.email, parsed.data.code);
    return result ? c.json(result) : c.json({ error: "Invitation expired, used, revoked, or addressed to another email" }, 409);
  })
  .use("/:id/*", async (c, next) => {
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success || !await repo.workspaceAccess(id!, c.get("authUser").id)) return c.json({ error: "Workspace access denied" }, 403);
    await next();
  })
  .get("/:id/members", async c => {
    const user = c.get("authUser");
    const access = await repo.workspaceAccess(c.req.param("id"), user.id);
    const rows = await repo.listMembers(c.req.param("id"));
    return c.json(rows.map(member => ({
      ...member,
      email: access?.role === "manager" || member.userId === user.id ? member.email : "",
    })));
  })
  .patch("/:id/members/:userId", async c => {
    const parsed = memberPatch.safeParse(await c.req.json());
    if (!parsed.success || !Object.keys(parsed.data).length) return c.json({ error: "Choose valid member settings" }, 400);
    const saved = await repo.updateMember(c.req.param("id"), c.get("authUser").id, c.req.param("userId"), parsed.data);
    return saved ? c.json({ saved: true }) : c.json({ error: "You cannot change this member" }, 403);
  })
  .delete("/:id/members/:userId", async c => {
    const saved = await repo.removeMember(c.req.param("id"), c.get("authUser").id, c.req.param("userId"));
    return saved ? c.json({ saved: true }) : c.json({ error: "Only the owner can remove another member" }, 403);
  })
  .get("/:id/invites", async c => {
    const access = await repo.workspaceAccess(c.req.param("id"), c.get("authUser").id);
    if (access?.ownerUserId !== c.get("authUser").id) return c.json({ error: "Owner access required" }, 403);
    return c.json(await repo.listInvites(c.req.param("id")));
  })
  .post("/:id/invites", async c => {
    const parsed = z.object({ email: z.string().trim().email().max(254), role }).strict().safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Enter an email and role" }, 400);
    const result = await repo.createInvite(c.req.param("id"), c.get("authUser").id, parsed.data.email, parsed.data.role);
    return result ? c.json(result, 201) : c.json({ error: "Only the owner of a team workspace can invite people" }, 403);
  })
  .delete("/:id/invites/:inviteId", async c => {
    if (!z.string().uuid().safeParse(c.req.param("inviteId")).success) return c.json({ error: "Invalid invitation" }, 400);
    const saved = await repo.revokeInvite(c.req.param("id"), c.get("authUser").id, c.req.param("inviteId"));
    return saved ? c.json({ saved: true }) : c.json({ error: "Owner access required" }, 403);
  });
