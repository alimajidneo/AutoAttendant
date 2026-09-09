> **Implementation update 2026-09-09:** Production API requests now default to `/api`; React Query uses a five-minute stale time, no focus refetch and at most one retry. Authenticated API responses send private/no-store, so shared infrastructure cannot cache one owner's data for another. Dashboard aggregation, Vercel entrypoint/configuration, hosted pooling and deployment acceptance below remain pending. Calendar OAuth is browser-bound without a session database or polling. See [ROADMAP.md](ROADMAP.md).

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

This preserves the development architecture. It requires a deployment adapter and production configuration, not an application rewrite.

## Required repository work

1. Split the Hono application export from the local Node listener. Local development continues to use `@hono/node-server`; the Vercel entrypoint default-exports the same Hono app.
2. Add a root Vercel configuration that builds `apps/web`, publishes `apps/web/dist`, routes `/api/*` to the Hono function, and sends other paths to the Vite SPA entrypoint.
3. Keep the API and website on one origin. The browser should use `/api` in production, eliminating cross-origin preflight requests and a separate public API domain.
4. Use Supabase's transaction pooler on port 6543 for Vercel Functions. Keep the direct or session-pooler URL for migrations and persistent local processes. Set the Vercel API pool to a small limit and do not run migrations during a Vercel build.
5. Select a Vercel Function region near the production Supabase region and the US customer. Region selection must use the actual production project location.
6. Store server credentials only in Vercel encrypted environment variables. Only the Supabase URL and publishable browser key use the `VITE_` prefix.
7. Configure a stable HTTPS staging domain and the final customer domain in Supabase redirect URLs and Google OAuth. Set API `PUBLIC_API_URL` to its stable public origin and authorize `${PUBLIC_API_URL}/api/calendar/oauth/callback` in Google. Preview deployment URLs are not production OAuth callbacks.
8. Package and deploy `apps/voice` separately through LiveKit Cloud with the same database, Google, LiveKit, and encryption configuration.

## Invocation budget

The current authenticated dashboard issues six distinct API requests after a cold page load:

- Onboarding session
- Settings
- Pending questions
- Metrics
- Appointments
- Recent calls

React Query deduplicates repeated settings consumers, but each distinct HTTP request still invokes the Vercel API function. Failed requests may also be retried.

Before deployment, reduce the dashboard to two requests:

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
