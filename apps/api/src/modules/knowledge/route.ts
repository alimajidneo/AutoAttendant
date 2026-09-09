import { Hono } from "hono";
import type { AppEnv } from "../../types.js";
import { listKnowledge, deleteKnowledge, createKnowledge } from "@receptionist/core/repositories/knowledge.js";
import { knowledgeCreateSchema } from "../../schemas.js";

export const knowledge = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listKnowledge(c.get("agentId"))))
  .post("/", async (c) => {
    const parsed = knowledgeCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    return c.json(await createKnowledge({ agentId: c.get("agentId"), ...parsed.data }), 201);
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    await deleteKnowledge(id, c.get("agentId"));
    return c.json({ id, deleted: true });
  });
