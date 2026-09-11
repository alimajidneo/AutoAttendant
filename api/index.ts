import { createApp } from "../apps/api/src/app.js";
import { env } from "../apps/api/src/env.js";

// Vercel invokes this Hono application for /api and /api/* requests. The local
// Node listener stays in apps/api/src/index.ts and is never started in a
// serverless function.
export default createApp({ allowedOrigins: env.DASHBOARD_ORIGINS });
