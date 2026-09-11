> **Implementation update 2026-09-11 (1.0.28):** The repository now has a root Vercel configuration and a serverless Hono entrypoint. Production browser requests use same-origin `/api`; React Query uses a five-minute stale time, no focus refetch and at most one retry. Authenticated API responses send `private, no-store`. The production build and entrypoint typecheck pass locally. Connecting Vercel, setting hosted secrets, hosted pooling, dashboard aggregation, OAuth callback registration, and live acceptance remain.

# Vercel deployment feasibility

Recorded 2026-09-08 from the current repository and official provider documentation.

## Verdict

Vercel Pro is feasible for the customer-facing Vite application and Hono HTTP API. It is not a runtime for the LiveKit voice worker, which registers over a persistent outbound WebSocket and must remain running between requests. Deploy that worker to LiveKit Cloud. Keep Supabase as PostgreSQL and Auth.

The supported hosted topology is:

| Component | Runtime |
| --- | --- |
| React/Vite dashboard | Vercel static deployment and CDN |
| Hono API | One Vercel Node.js Function mounted at `/api/*` |
| Voice worker | LiveKit Cloud agent deployment |
| Database and authentication | Supabase |
| Calendar | Google Calendar API |

This preserves the development architecture. The deployment adapter is implemented in `api/index.ts` and `vercel.json`; provider configuration and hosted acceptance still have to be completed.

## Deployment status

1. **Implemented:** the local listener and reusable Hono application are separate; `api/index.ts` exports the application for Vercel.
2. **Implemented:** `vercel.json` builds the monorepo from its root, publishes `apps/web/dist`, routes `/api/*` to one Node.js function, and routes website paths to the Vite SPA.
3. **Implemented:** the production browser defaults to same-origin `/api`, avoiding a separate API origin and normal CORS preflights.
4. **Configure in Vercel:** use Supabase's transaction pooler on port 6543 and set `DATABASE_POOL_MAX=1`. Keep the direct or session-pooler URL for migrations and persistent local processes. Never run migrations during a Vercel build.
5. **Configure after import:** select a Vercel Function region near the production Supabase region and the US customer. Use the actual project locations.
6. **Configure before deployment:** store server credentials only in Vercel environment variables. Only the Supabase URL and publishable browser key use the `VITE_` prefix.
7. **Configure after assigning the stable domain:** add that HTTPS origin to Supabase and the Google, Slack, and Microsoft OAuth callback lists. Preview URLs are unsuitable for stable OAuth testing.
8. **Separate next task:** package and deploy `apps/voice` through LiveKit Cloud with the same database, provider, LiveKit, and encryption configuration.

## Invocation budget

The current authenticated dashboard issues six distinct API requests after a cold page load:

- Onboarding session
- Settings
- Pending questions
- Metrics
- Appointments
- Recent calls

React Query deduplicates repeated settings consumers, but each distinct HTTP request still invokes the Vercel API function. Failed requests may also be retried.

The next invocation-reduction change is to reduce the dashboard to two requests:

1. One cached onboarding/session request.
2. One authenticated dashboard request containing settings summary, metrics, pending-question count, today's appointments, and recent calls.

Use these controls throughout the dashboard:

- Keep API traffic same-origin so normal requests do not generate CORS preflight invocations.
- Disable refetch-on-window-focus for owner dashboard data.
- Retry a failed query at most once instead of the default retry sequence.
- Use a five-minute client stale time for settings and summary data.
- Do not poll calls, appointments, metrics, or worker state. Refresh after a mutation or explicit user action.
- Fetch recordings only when the owner opens a call that has one.
- Serve the Vite bundle, fonts, and icons as static CDN assets, never through the API function.
- Keep call-time database and Calendar work in the LiveKit worker. A telephone call should not create Vercel API invocations unless a future webhook explicitly requires one.

For one owner opening the dashboard ten times per day, the two-request target is roughly 600 API invocations per month before mutations. Voice calls do not multiply that figure because the deployed worker talks directly to Supabase, Google, and LiveKit.

## Operational limits

- Vercel Functions have bounded execution time and cannot run the persistent voice worker.
- Fluid Compute can reuse warm Node.js instances and handle concurrent HTTP requests, which makes a module-level database pool practical when it is kept small.
- Supabase transaction pooling is designed for temporary serverless clients and does not support prepared statements. The current `pg` usage does not name prepared statements, but production database behavior still needs a hosted smoke test.
- Vercel preview deployments are useful for visual review. A stable staging domain is required for reliable OAuth and integration testing.
- LiveKit Build agents may scale to zero and cold-start during testing. Production latency must be measured before customer handover.

## Acceptance gate

Vercel deployment is accepted only after the public HTTPS installation passes sign-in, settings persistence, browser voice, exact-time availability, booking, cancellation, tenant isolation, function restart, and secret-boundary checks. Deployment does not by itself make the application customer-ready.

## Official references

- [Hono on Vercel](https://hono.dev/docs/getting-started/vercel)
- [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Supabase Postgres connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [LiveKit agent deployment](https://docs.livekit.io/deploy/agents/quickstart/)

## Running without local terminals

Updated 2026-09-11. The `pnpm dev:*` commands are the developer workflow, not the customer workflow. The Vercel adapter and build configuration are ready; the hosted deployment is pending.

1. Connect the GitHub repository to Vercel, set the environment variables, and publish the prepared website/API build. Vercel then deploys automatically from Git pushes. Customers only open the HTTPS application URL. Follow [the detailed Vercel steps](SETUP.md#10-deploy-the-website-and-api-to-vercel). [Vercel Git deployments](https://vercel.com/docs/git).
2. Package the voice worker for LiveKit Cloud (or one managed container host if chosen after cost verification). The host runs its production start command, manages the process and replaces failed instances. Add health checks and startup validation. It must not depend on a laptop terminal or Vercel request lifetime. [LiveKit agent deployment](https://docs.livekit.io/deploy/agents/).
3. Configure stable production authentication/calendar callbacks, public URLs and the shared database connection settings. Keep separate staging credentials and explicit production configuration.
4. Set deploy-time checks, logs, health alerts and a rollback process. A process restarting does not guarantee a call already in progress survives; test that failure and the caller fallback explicitly.
5. Shut down all local development processes and test sign-in, calendar access, booking and browser handoff from two other devices. This is the acceptance criterion for independence from the developer's computer.

For local work, the existing root `pnpm dev` starts API, web and voice together in one terminal. It still runs locally and stops when that process/computer stops. Do not present it as deployment. No new paid hosting was activated by documenting this plan.
