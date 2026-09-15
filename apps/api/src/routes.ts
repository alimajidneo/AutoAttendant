import { calcom, calcomWebhooks, calcomMaintenance } from './modules/calcom/route.js';
import { employeeCalcom } from './modules/calcom/employee-route.js';
import { calcomOAuthCallback } from './modules/calcom/oauth-callback.js';
import { retell, retellSettings } from './modules/retell/route.js';
import { Hono } from "hono";
import type { AppEnv } from "./types.js";
import { authenticate, requireAgent, requireManager } from "./middleware/auth.js";
import { employees } from "./modules/employees/route.js";
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

// Calls and appointments are shared operational records. Every verified member
// may read their workspace's lists; each module protects its own manager-only
// detail and mutation routes. The remaining administration surface stays
// behind the manager check.
const memberAdmin = new Hono<AppEnv>()
  .use("*", authenticate, requireAgent)
  .route("/calls", calls)
  .route("/appointments", appointments)
  .route("/employee", employeeCalcom);

const managerAdmin = new Hono<AppEnv>()
  .use("*", authenticate, requireAgent, requireManager)
  .route("/retell", retellSettings)
  .route("/employees", employees)
  .route("/calcom", calcom)
  .route("/notifications", notifications)
  .route("/metrics", metrics)
  .route("/escalations", escalations)
  .route("/knowledge", knowledge)
  .route("/services", services)
  .route("/settings", settings)
  .route("/calendar", calendar)
  .route("/slack", slack)
  .route("/phone", telephony)
  .route("/agent", agent);

export const routes = new Hono()
  .route("/internal/calcom", calcomMaintenance)
  .route("/calcom/webhooks", calcomWebhooks)
  .route("/retell", retell)
  .route("/health", health)
  .route("/calendar/oauth", calendarOAuthCallback)
  .route("/calcom/oauth", calcomOAuthCallback)
  .route("/microsoft/oauth", microsoftOAuthCallback)
  .route("/slack/oauth", slackOAuthCallback)
  .route("/onboarding", onboarding)
  .route("/workspaces", workspaces)
  .route("/transfers", transfers)
  .route("/admin", memberAdmin)
  .route("/admin", managerAdmin);

export type AppRoutes = typeof routes;
