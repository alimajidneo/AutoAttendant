> **Current scope (2026-09-09):** [Delivery roadmap](docs/ROADMAP.md) — verify multiple Google/Microsoft calendars and privacy first, then company workspaces, employees and call routing. Workspace support is agreed, not yet implemented.

# Receptionist for USA customer handover

Active implementation scope from the updated 2026-09-08 daily work plan, especially sections 2A and 2B. The user’s later customer-handover requirements below supersede personal-use language and the earlier Clerk decision.

- Deliver a configurable receptionist for a customer in the USA. Browser voice is an early test milestone; reliable US telephone operation and hosted operation are required before handover. No developer-specific identity, calendar, timezone, or routing is embedded in the product.
- Use Supabase for PostgreSQL, existing Drizzle repositories, Supabase Auth, and LiveKit Cloud Build. Run the worker locally during development and deploy it to LiveKit Cloud for hosted operation.
- Target Vercel Pro for the eventual customer-facing web application and compatible API endpoints. Keep the persistent LiveKit voice worker outside Vercel.
- Keep testing within available free allowances. No phone purchase, paid upgrade, or carrier traffic is needed for the first milestone. Model inference consumes credits even when transport has a free allowance.
- Preserve the existing working UI and voice safeguards. Extend the existing application rather than replace its architecture.
- Direct connections to multiple Google accounts and cross-account conflict calendars are implemented. Slack approval remains the next application integration.
- Decide telephone routing after checking the US customer's existing number, forwarding support, and costs. Twilio and Telnyx remain candidates for that later step.

## First milestone acceptance

An authenticated owner can finish setup without buying a number, persist settings in Supabase, and reload those settings after restarting the API. A browser conversation can find and book an available meeting in a dedicated test calendar, with matching database and calendar records. Calendar failures must not be presented as successful bookings or cancellations.

## Current boundary

Local phone-free onboarding, Supabase Auth, schema migration, separately encrypted Google-account connections, settings persistence, exact-time availability, general appointments, cross-account conflict-calendar selection, dashboard cancellation, explicit Calendar reconciliation, and a Google-backed month view are implemented. Additional Gmail accounts are Calendar data connections and do not become DeskRoute login identities. Real Google sign-in, onboarding, browser voice, availability, and one Calendar booking have been manually accepted. Direct multi-account authorization and cross-account availability need live acceptance after adding the API callback URI and restarting the processes. Hosted operation and production acceptance remain pending.

External rollout, phone handoff, and all fifteen days are not complete. Preserve the upstream AGPL license and source offer; the owner's rollout/license acceptance remains a plan checkpoint.

## Handover contract

Use one supported architecture from development through customer delivery. No placeholder functionality, invented credentials, hard-coded personal settings, or customer-executed authentication/data migration. Complete the auth replacement during development. Provide verified deployment, customer configuration, calendar token renewal, tenant isolation, US inbound/transfer behavior, cost records, and backup/recovery instructions. Normal versioned schema upgrades and environment configuration are handled as deployment work, not passed to the customer as unfinished implementation. Free testing does not imply free production operation.
