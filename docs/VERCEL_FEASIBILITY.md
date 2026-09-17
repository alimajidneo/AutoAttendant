> **Implementation update 2026-09-17 (1.0.30):** The current pilot is Retell-only and USA-only. The repository has a root Vercel configuration and serverless Hono entrypoint. LiveKit is optional, unconfigured and hidden; its persistent worker is not part of this deployment. Connecting Vercel, setting hosted secrets/pooling, applying reviewed migrations after backup, callback registration, and live acceptance remain. No deployment is authorized by this document.

# Vercel deployment feasibility

Recorded 2026-09-08 from the current repository and official provider documentation.

## Verdict

Vercel Pro is feasible for the customer-facing Vite application and Hono HTTP API. Retell hosts the conversation and telephone runtime, so the current pilot needs no persistent DeskRoute voice worker. Keep Supabase as PostgreSQL and Auth. The legacy LiveKit worker remains optional and must not be deployed or configured for the Retell-only pilot.

The supported hosted topology is:

| Component | Runtime |
| --- | --- |
| React/Vite dashboard | Vercel static deployment and CDN |
| Hono API | One Vercel Node.js Function mounted at `/api/*` |
| Voice and telephone runtime | Retell-managed service; no DeskRoute worker deployment |
| Database and authentication | Supabase |
| Calendar | Google Calendar API |

The deployment adapter is implemented in `serverless/index.ts`, `api/index.mjs`, `scripts/build-vercel-api.mjs`, and `vercel.json`; provider configuration and hosted acceptance still have to be completed. The build bundles internal TypeScript workspaces into a self-contained Node 22 function artifact so Vercel never ships their raw `.ts` sources to the runtime.

## Deployment status

1. **Implemented:** the local listener and reusable Hono application are separate; `serverless/index.ts` exports the checked application source, and `api/index.mjs` loads the generated serverless bundle.
2. **Implemented:** `vercel.json` builds the monorepo from its root, publishes `apps/web/dist`, routes `/api/*` to one Node.js function, and routes website paths to the Vite SPA.
3. **Implemented:** the production browser defaults to same-origin `/api`, avoiding a separate API origin and normal CORS preflights.
4. **Configure in Vercel:** use Supabase's transaction pooler on port 6543 and set `DATABASE_POOL_MAX=1`. Keep the direct or session-pooler URL for migrations and persistent local processes. Never run migrations during a Vercel build.
5. **Configure after import:** select a Vercel Function region near the production Supabase region and the US customer. Use the actual project locations.
6. **Configure before deployment:** store server credentials only in Vercel environment variables. Only the Supabase URL and publishable browser key use the `VITE_` prefix.
7. **Configure after assigning the stable domain:** add that HTTPS origin to Supabase and the Google, Slack, and Microsoft OAuth callback lists. Preview URLs are unsuitable for stable OAuth testing.
8. **Retell-only rule:** do not configure `LIVEKIT_*`, do not set `VITE_LIVEKIT_ENABLED`, and do not deploy `apps/voice`. Retell invokes the public signed `/api/retell/*` routes instead.

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
- Retell custom functions and lifecycle webhooks invoke the Vercel API during a call. Bound each function, keep write retries disabled, and include those calls when measuring invocation volume.

For one owner opening the dashboard ten times per day, the two-request target is roughly 600 API invocations per month before mutations. Retell function and webhook traffic is additional and must be measured during the controlled pilot.

## Operational limits

- Vercel Functions have bounded execution time and cannot run the persistent voice worker.
- Fluid Compute can reuse warm Node.js instances and handle concurrent HTTP requests, which makes a module-level database pool practical when it is kept small.
- Supabase transaction pooling is designed for temporary serverless clients and does not support prepared statements. The current `pg` usage does not name prepared statements, but production database behavior still needs a hosted smoke test.
- Vercel preview deployments are useful for visual review. A stable staging domain is required for reliable OAuth and integration testing.
- Retell-to-Vercel function latency and Vercel cold starts must be measured before customer handover.

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
2. Configure Retell's versioned draft agent to call the stable public DeskRoute HTTPS functions and webhook. Do not deploy the optional LiveKit worker for this pilot.
3. Configure stable production authentication/calendar callbacks, public URLs and the shared database connection settings. Keep separate staging credentials and explicit production configuration.
4. Set deploy-time checks, logs, health alerts and a rollback process. Test API timeout/failure behavior and the caller fallback explicitly.
5. Shut down all local development processes and test sign-in, calendar access, booking and browser handoff from two other devices. This is the acceptance criterion for independence from the developer's computer.

For local work, the existing root `pnpm dev` starts API, web and voice together in one terminal. It still runs locally and stops when that process/computer stops. Do not present it as deployment. No new paid hosting was activated by documenting this plan.
