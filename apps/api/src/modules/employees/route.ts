import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types.js";
import { requireManager } from "../../middleware/auth.js";
import * as repo from "@receptionist/core/repositories/employees.js";
import { employeeDraft, employeePatch, employeePolicy } from "./schemas.js";

const page = z.object({ limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(10000).default(0) }).strict();
export const employees = new Hono<AppEnv>()
  .onError((error, c) => {
    if (error instanceof repo.EmployeeBookingInProgressError) return c.json({ error: error.message }, 409);
    throw error;
  })
  .use("*", requireManager)
  .get("/", async c => {
    const parsed = page.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "Invalid employee page" }, 400);
    return c.json(await repo.listEmployees(c.get("agentId"), parsed.data.limit, parsed.data.offset));
  })
  .get("/connections", async c => c.json(await repo.listEmployeeConnections(c.get("agentId"))))
  .post("/", async c => {
    const parsed = employeeDraft.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Enter valid employee details" }, 400);
    return c.json(await repo.createEmployee(c.get("agentId"), parsed.data), 201);
  })
  .use("/:id/*", async (c, next) => {
    if (!z.string().uuid().safeParse(c.req.param("id")).success) return c.json({ error: "Invalid employee" }, 400);
    await next();
  })
  .patch("/:id", async c => {
    const parsed = employeePatch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Enter valid employee details" }, 400);
    const saved = await repo.updateEmployee(c.get("agentId"), c.req.param("id"), parsed.data);
    return saved ? c.json(saved) : c.json({ error: "Employee not found" }, 404);
  })
  .post("/:id/deactivate", async c => {
    if (!z.object({}).strict().safeParse(await c.req.json().catch(() => null)).success) return c.json({ error: "Invalid deactivation" }, 400);
    const saved = await repo.deactivateEmployee(c.get("agentId"), c.req.param("id"));
    return saved ? c.json(saved) : c.json({ error: "Employee not found" }, 404);
  })
  .patch("/:id/connections/:connectionId", async c => {
    const parsed = z.object({ assigned: z.boolean() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !z.string().uuid().safeParse(c.req.param("connectionId")).success) return c.json({ error: "Invalid calendar assignment" }, 400);
    const saved = await repo.assignEmployeeConnection(c.get("agentId"), c.req.param("id"), c.req.param("connectionId"), parsed.data.assigned);
    return saved ? c.json({ saved: true }) : c.json({ error: "Account or employee unavailable; unassign the current employee first" }, 409);
  })
  .patch("/:id/policy", async c => {
    const parsed = employeePolicy.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Choose valid direct calendars or a Cal.com event reference / HTTPS URL" }, 400);
    const saved = await repo.saveEmployeePolicy(c.get("agentId"), c.req.param("id"), parsed.data);
    return saved ? c.json(saved) : c.json({ error: "Employee or assigned calendar account unavailable" }, 409);
  });
