import { Hono } from "hono";
import type { AppEnv } from "./types.js";
import { authenticate, requireAgent, requireManager } from "./middleware/auth.js";
import { health } from "./modules/health/route.js";
import { onboarding } from "./modules/onboarding/route.js";
import { metrics } from "./modules/metrics/route.js";
import { calls } from "./modules/calls/route.js";
import { escalations } from "./modules/escalations/route.js";
import { knowledge } from "./modules/knowledge/route.js";
import { appointments } from "./modules/appointments/route.js";
import { services } from "./modules/services/route.js";
import { settings } from "./modules/settings/route.js";
import { calendar } from "./modules/calendar/route.js";
import { telephony } from "./modules/telephony/route.js";
import { agent } from "./modules/agent/route.js";
import { calendarOAuthCallback } from "./modules/calendar/oauth-callback.js";
import { microsoftOAuthCallback } from "./modules/calendar/microsoft-oauth-callback.js";
import { slackOAuthCallback } from "./modules/slack/oauth-callback.js";
import { slack } from "./modules/slack/route.js";

import { transfers } from "./modules/transfers/route.js";
import { workspaces } from "./modules/workspaces/route.js";
import { notifications } from "./modules/notifications/route.js";

const admin = new Hono<AppEnv>()
  .use("*", authenticate, requireAgent, requireManager)
  .route("/notifications", notifications)
  .route("/metrics", metrics)
  .route("/calls", calls)
  .route("/escalations", escalations)
  .route("/knowledge", knowledge)
  .route("/appointments", appointments)
  .route("/services", services)
  .route("/settings", settings)
  .route("/calendar", calendar)
  .route("/slack", slack)
  .route("/phone", telephony)
  .route("/agent", agent);

export const routes = new Hono()
  .route("/health", health)
  .route("/calendar/oauth", calendarOAuthCallback)
  .route("/microsoft/oauth", microsoftOAuthCallback)
  .route("/slack/oauth", slackOAuthCallback)
  .route("/onboarding", onboarding)
  .route("/workspaces", workspaces)
  .route("/transfers", transfers)
  .route("/admin", admin);

export type AppRoutes = typeof routes;
