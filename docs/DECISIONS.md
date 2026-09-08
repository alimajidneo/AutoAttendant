# Initial implementation decisions

Recorded 2026-09-08.

| Area | Decision | Reason |
| --- | --- | --- |
| Database | Supabase PostgreSQL through the existing Drizzle/pg backend | Requested by owner; no ORM rewrite or browser database access. |
| Authentication | Supabase Auth | Implemented Google sign-in, server-verified ownership, and encrypted Calendar refresh tokens. Live acceptance remains pending. |
| Voice | LiveKit Cloud Build, local worker | Browser testing avoids number rental and PSTN charges; existing application already uses LiveKit. |
| Models | Existing LiveKit inference provider initially | Avoid another provider account; choose supported models and check credits before a live session. |
| Carrier | Defer Twilio/Telnyx selection | Browser milestone needs neither; eventual cost depends on country and forwarding route. |
| Recording | Leave optional R2 configuration unset initially | Avoid another service and recording storage costs. |
| Runtime | Node 22.23.1, pnpm 10.34.5 | Versions used for the passing local baseline; retain the existing dependency lockfile. |

LiveKit's free plan is an allowance, not unlimited free speech inference. Review the project usage page before tests. Self-hosting media alone would still require speech/model services and adds operational work, so it is deferred.

For Supabase, use the direct connection when reachable over IPv6, or the session pooler on port 5432 for IPv4. Transaction pooling is not the initial choice for these persistent Node processes. Client-to-pooler TLS, PostgreSQL 17.6, and the database connection were verified. Pools default to 3 per process. Schema migrations are prepared for the deployment owner to apply; integration-test cleanup refuses hosted database targets.

## Customer delivery target

The product is for customer handover in the USA, not a personal app for its developer. The user confirmed the Supabase Data API is disabled. Keep the chosen Supabase/Drizzle/LiveKit architecture through delivery; do not require a customer to change providers or migrate data after handover. Configuration must use actual supported fields and real provider credentials, with no placeholder behavior.

Local worker execution and Google OAuth testing mode are development arrangements. Hosted operation, production OAuth readiness, verified US telephone routing, data isolation, recovery, and measured costs are handover requirements. Existing customer number/forwarding details, hosting region, and approved operating budget remain deployment inputs.

## Official references

- [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Drizzle integration](https://supabase.com/docs/guides/database/drizzle)
- [Supabase plans](https://supabase.com/pricing)
- [LiveKit voice quickstart](https://docs.livekit.io/agents/start/voice-ai/)
- [LiveKit plans](https://livekit.com/pricing)
- [Supabase Google authentication](https://supabase.com/docs/guides/auth/social-login/auth-google)

Provider allowances and model catalogs can change; the dashboard is the final check before usage.
