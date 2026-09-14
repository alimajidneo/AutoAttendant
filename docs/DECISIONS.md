> **2026-09-10 update:** Implement personal/team workspaces now, as requested. Preserve existing data and keep calendar details owner-only. Use browser handoff for the initial routing test; do not purchase a number or configure paid phone routes. Deploy staging before telephone integration. See [workspace decisions and limitations](WORKSPACES_AND_TRANSFERS.md). This supersedes the earlier Microsoft-before-workspaces ordering below.

# Scope decision — 2026-09-09

Follow [ROADMAP.md](ROADMAP.md) as the current task order. Keep Supabase Auth; calendar accounts remain separate from sign-in identities. Verify multiple Google accounts and Microsoft calendars before implementing company workspaces. The target model is user-owned calendar connections with explicit availability sharing to workspaces, company-owned receptionists and employee routing. Current connections are agent-owned; implement a reviewed data upgrade before multi-company rollout. No workspace administrator receives private calendar content simply through membership.

Vercel Pro remains the website/HTTP API target; the persistent voice worker stays separate. Same-origin requests, aggregated reads and bounded caching remain work to verify, not deployed guarantees. Google and Microsoft failures must not silently widen availability. Mike's phone system is a discovery input to collect early, without blocking calendar tests.

# Initial implementation decisions

Recorded 2026-09-08.

| Area | Decision | Reason |
| --- | --- | --- |
| Database | Supabase PostgreSQL through the existing Drizzle/pg backend | Requested by owner; no ORM rewrite or browser database access. |
| Authentication | Supabase Auth | Google login identifies the DeskRoute owner. Calendar OAuth is a separate backend flow so one owner can connect several Google accounts without changing their login session. |
| Voice | LiveKit Cloud Build for testing, with eventual LiveKit Cloud agent deployment | Browser testing avoids number rental and PSTN charges; the long-running worker remains outside Vercel. |
| Hosting | Vercel Pro for the eventual customer-facing web application and compatible API endpoints | Selected by the owner. Prepare the existing Vite application for Vercel without changing Supabase, Drizzle, or LiveKit. Do not attempt to run the persistent voice worker in a Vercel Function. |
| Invocation budget | Aggregate dashboard reads and keep the API same-origin | Target two API invocations for a cold dashboard load, avoid polling and CORS preflights, and keep call-time work in the LiveKit worker. |
| Models | Existing LiveKit inference provider initially | Avoid another provider account; choose supported models and check credits before a live session. |
| Carrier | Defer Twilio/Telnyx selection | Browser milestone needs neither; eventual cost depends on country and forwarding route. |
| Recording | Leave optional R2 configuration unset initially | Avoid another service and recording storage costs. |
| Runtime | Node 22.23.1, pnpm 10.34.5 | Versions used for the passing local baseline; retain the existing dependency lockfile. |

LiveKit's free plan is an allowance, not unlimited free speech inference. Review the project usage page before tests. Self-hosting media alone would still require speech/model services and adds operational work, so it is deferred.

For Supabase, use the direct connection when reachable over IPv6, or the session pooler on port 5432 for IPv4. Transaction pooling is not the initial choice for these persistent Node processes. Client-to-pooler TLS, PostgreSQL 17.6, and the database connection were verified. Pools default to 3 per process. Migrations through `0011_retell_boundary` were applied to the currently configured Supabase database on 2026-09-14 after a private recovery package was verified; integration-test cleanup still refuses hosted database targets.

## Customer delivery target

The product is for customer handover in the USA, not a personal app for its developer. The user confirmed the Supabase Data API is disabled. Keep the chosen Supabase/Drizzle/LiveKit architecture through delivery; do not require a customer to change providers or migrate data after handover. Configuration must use actual supported fields and real provider credentials, with no placeholder behavior.

Local worker execution and Google OAuth testing mode are development arrangements. The eventual customer-facing application will use Vercel Pro; the LiveKit voice worker must use LiveKit Cloud or another persistent worker runtime. Hosted operation, production OAuth readiness, verified US telephone routing, data isolation, recovery, and measured costs are handover requirements. Existing customer number/forwarding details, hosting region, and approved operating budget remain deployment inputs.

## Official references

- [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Drizzle integration](https://supabase.com/docs/guides/database/drizzle)
- [Supabase plans](https://supabase.com/pricing)
- [LiveKit voice quickstart](https://docs.livekit.io/agents/start/voice-ai/)
- [LiveKit plans](https://livekit.com/pricing)
- [Supabase Google authentication](https://supabase.com/docs/guides/auth/social-login/auth-google)

Provider allowances and model catalogs can change; the dashboard is the final check before usage.

The detailed Vercel assessment and invocation controls are in [VERCEL_FEASIBILITY.md](./VERCEL_FEASIBILITY.md).
