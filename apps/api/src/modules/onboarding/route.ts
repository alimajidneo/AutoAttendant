import { listWorkspaces } from "@receptionist/core/repositories/workspaces.js";
import { Hono } from "hono";
import { authenticate } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";
import {
  createAgent,
  addPhoneNumber,
  resolveAgentByAuthUserId,
} from "@receptionist/core/repositories/agents.js";
import { replaceServices } from "@receptionist/core/repositories/services.js";
import {
  searchPhoneNumbers,
  purchasePhoneNumber,
  releasePhoneNumber,
  InvalidAreaCode,
} from "@receptionist/core/providers/telephony.js";
import { onboardingCreateSchema } from "../../schemas.js";

export const onboarding = new Hono<AppEnv>()
  .use("*", authenticate)
  /** Outside requireAgent, which 404s exactly when the answer is no. */
  .get("/session", async (c) => {
    const auth = c.get("authUser");
    if (!auth?.id) return c.json({ error: "Unauthorized" }, 401);
    const workspaces = await listWorkspaces(auth.id);
    const selected = c.req.header("X-Workspace-Id");
    const current = selected ? workspaces.find(item => item.id === selected) : workspaces[0];
    return c.json({ onboarded: !!current, role: current?.role, workspaceOwner: current?.ownerUserId === auth.id,
      workspaceId: current?.id, hasWorkspaces: workspaces.length > 0 });
  })
  .get("/phone/search", async (c) => {
    const auth = c.get("authUser");
    if (!auth?.id) return c.json({ error: "Unauthorized" }, 401);
    try {
      return c.json(await searchPhoneNumbers(c.req.query("areaCode")));
    } catch (err) {
      if (err instanceof InvalidAreaCode) return c.json({ message: err.message }, 400);
      throw err;
    }
  })
  .post("/", async (c) => {
    const auth = c.get("authUser");
    if (!auth?.id) return c.json({ error: "Unauthorized" }, 401);

    const parsed = onboardingCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { phoneNumber, services, name, agentProfile, ...agentData } = parsed.data;

    // Checked before the purchase, so a double submit cannot cost a number.
    if (await resolveAgentByAuthUserId(auth.id)) {
      return c.json({ message: "This account already has a business set up." }, 409);
    }

    const purchased = phoneNumber ? await purchasePhoneNumber(phoneNumber) : null;
    try {
      const agent = await createAgent({
        authUserId: auth.id,
        authEmail: auth.email_confirmed_at ? auth.email : undefined,
        businessName: name,
        personaName: agentProfile?.name,
        greeting: agentProfile?.greeting,
        farewell: agentProfile?.farewell,
        fallback: agentProfile?.fallback,
        bookingQuestions: agentProfile?.bookingQuestions,
        ...agentData,
      });
      if (purchased) {
        await addPhoneNumber({
          agentId: agent.id,
          e164: purchased.e164_format,
          provider: "livekit",
        });
      }
      if (services.length > 0) await replaceServices(agent.id, services);
    } catch (dbErr) {
      if (purchased) {
        await releasePhoneNumber(purchased.e164_format).catch((e: unknown) =>
          console.error("[onboarding] rollback release failed:", e)
        );
      }
      throw dbErr;
    }

    return c.json({ ok: true });
  });
