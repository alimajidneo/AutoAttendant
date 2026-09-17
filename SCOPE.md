> **Current scope (2026-09-17):** [Delivery roadmap](docs/ROADMAP.md) — the immediate pilot is Retell-only with USA numbers and US transfer destinations. Pakistan/international routes, custom SIP, LiveKit deployment and number purchase are deferred.

# Receptionist for USA customer handover

Active implementation scope from the updated 2026-09-08 daily work plan, especially sections 2A and 2B. The user’s later customer-handover requirements below supersede personal-use language and the earlier Clerk decision.

- Deliver a configurable receptionist for a customer in the USA. Retell text/web testing is a pre-telephone milestone; reliable US telephone operation and hosted operation are required before handover. No developer-specific identity, calendar, timezone, or routing is embedded in the product.
- Use Supabase for PostgreSQL/Auth, the existing Drizzle repositories, and Retell for hosted conversation/telephony. LiveKit remains optional legacy code and is not deployed for this pilot.
- Target Vercel Pro for the customer-facing web application and request-scoped HTTP API. Retell calls the signed DeskRoute routes; no persistent application worker is required.
- Do not assume provider simulation or web calls are free. Under a zero-cost instruction, run only local mocked/disposable tests until the provider dashboard proves a free allowance or Ali approves spend.
- Preserve the existing working UI and voice safeguards. Extend the existing application rather than replace its architecture.
- Direct Google and Microsoft account connections, mixed-provider conflict checks, and selected-channel Slack alerts are implemented. Microsoft/Slack live acceptance and Slack transfer approval remain.
- Start with one Retell-managed US local number after Ali separately approves purchase. Twilio/Telnyx SIP and international routes are later options, not first-pilot dependencies.

## First milestone acceptance

An authenticated owner can finish setup without buying a number, persist settings in Supabase, and reload those settings after restarting the API. A Retell draft can find and book an available meeting through signed DeskRoute functions in an isolated authorized environment, with matching database and calendar records. Calendar failures must not be presented as successful bookings or cancellations. Retell web calls may be metered and transfer itself requires a real telephone call.

## Current boundary

Local phone-free onboarding, Supabase Auth, schema migration, separately encrypted Google-account connections, settings persistence, exact-time availability, general appointments, cross-account conflict-calendar selection, dashboard cancellation, explicit Calendar reconciliation, and a Google-backed month view are implemented. Additional Gmail accounts are Calendar data connections and do not become DeskRoute login identities. Real Google sign-in, onboarding, browser voice, availability, and one Calendar booking have been manually accepted. Direct multi-account authorization and cross-account availability need live acceptance after adding the API callback URI and restarting the processes. Hosted operation and production acceptance remain pending.

External rollout, phone handoff, and all fifteen days are not complete. Preserve the upstream AGPL license and source offer; the owner's rollout/license acceptance remains a plan checkpoint.

## Handover contract

Use one supported architecture from development through customer delivery. No placeholder functionality, invented credentials, hard-coded personal settings, or customer-executed authentication/data migration. Complete the auth replacement during development. Provide verified deployment, customer configuration, calendar token renewal, tenant isolation, US inbound/transfer behavior, cost records, and backup/recovery instructions. Normal versioned schema upgrades and environment configuration are handled as deployment work, not passed to the customer as unfinished implementation. Free testing does not imply free production operation.
