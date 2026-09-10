# Workspaces and browser handoff

Updated 2026-09-10 for v1.0.22. This is the first shared-workspace implementation. It preserves existing account and calendar IDs. Browser handoff is implemented and covered by mocked API/worker and database checks; a two-person live microphone acceptance test is still required.

## Upgrade and restart

1. Stop the API and voice worker with Ctrl+C in their terminals.
2. From the repository root, run `pnpm db:migrate`. Migration `0007_square_darwin` creates workspace membership, invitations and browser-transfer requests. It turns each existing authenticated receptionist into a personal workspace owned by the same user, and assigns existing notification read receipts to that owner. Calendar credentials and bookings keep their existing IDs and encryption context.
3. Run `pnpm dev:api`, `pnpm dev:web` and `pnpm dev:voice` in separate terminals. Do not start a duplicate web server if it is already running.
4. Reload DeskRoute. The top bar shows the current business and **Switch**. Click it to open **Workspaces**.

The migration is forward-only. Do not roll back to an older API after applying the notification read-receipt key change. The migration refuses orphaned read receipts without an identifiable owner instead of silently assigning private data to another user.

## Personal and team workspaces

- **Personal:** only its owner can belong. Use it for your own receptionist and calendars.
- **Team:** create a separate receptionist and explicitly invite people. Creating a team never copies personal bookings, connected accounts, private calendar events or FAQ content into it.
- **Owner:** a manager who can invite, revoke invitations, change member roles and remove other members. Owner transfer and workspace deletion are intentionally not available in this first version.
- **Manager:** configure the shared receptionist, opening hours, business, FAQ, services and routing directory; view and manage that workspace's business bookings, calls and questions.
- **Member:** view the teammate directory, edit their own name/department/transfer availability and accept a browser transfer addressed to them. Members cannot read business calls, bookings, transcripts, notifications or settings through manager endpoints.

A workspace currently has one receptionist and one owner-managed set of Google connections. The owner can connect multiple Google accounts as before. Only the owner may manage these connections or view external personal event details; other managers see DeskRoute bookings in the calendar. Personal availability is not automatically shared between a user's workspaces. Employee-owned calendar sharing and cross-company scheduling remain separate work.

## Create and join a team

1. Open **Workspaces** from the top bar.
2. Under **Create a workspace**, enter the actual business/team name, select **Team**, and check its timezone. The browser suggests your timezone; use the business timezone if different.
3. Click **Create workspace**. Open its dashboard to configure business, hours, agent and FAQ. The owner can connect the calendar under **Settings → Connections**.
4. Return to Workspaces. Under **Invite a teammate**, enter the exact email they will use to sign in. Choose **Member** for a transfer recipient or **Manager** if they should manage business records/settings.
5. Click **Create invitation**, copy the displayed code, and share it privately. DeskRoute does not send an email. The code is shown once, expires in seven days and is stored only as a hash. The owner can revoke it.
6. The teammate signs in. On the initial setup screen, click **Have an invitation? Join a workspace**, or open `/workspaces`.
7. Paste the code under **Join a workspace**. Their verified sign-in email must match the invited email. The code is consumed once; accepting another invitation never silently promotes an existing member.
8. Each teammate enters the name callers should use and their department in **People & routing**. Save their settings.

Workspace selection is per browser tab. Switching performs a full navigation to discard the old React query cache and active microphone session. Each HTTP request checks current membership; knowing a workspace UUID is not permission. A sign-in account change clears cached queries. Notification read state is per person, per workspace.

## Browser handoff test without a phone number

This test uses the existing LiveKit browser agent. It does not provision a number, call a mobile/SIM, send SMS or use a carrier. It consumes LiveKit connection/agent minutes and whichever speech/model providers are configured, so it fits within free allowances only while those allowances remain available. No paid test was run automatically for this release.

1. Keep the API, website and voice worker running. Restart the worker after this update.
2. Use two browser sessions or computers. On a single computer, use headphones and separate signed-in browser sessions to avoid feedback. Both sessions select the same team workspace. For an initial solo check, the owner can use two tabs of their own workspace.
3. The recipient opens **Workspaces → People & routing**, enters their name and department, enables **Available for browser transfers**, and clicks **Save**. They leave this page open.
4. A manager opens the workspace dashboard in the caller session and starts **Test agent**.
5. Ask to speak to the saved name or department. When more than one teammate matches, choose a person. The agent requests that person's acceptance; it must not say the handoff is complete yet.
6. The recipient clicks **Check incoming transfers**, then **Accept & connect microphone**. Approve microphone access if the browser asks. This connects a real second browser participant to the caller's LiveKit room.
7. Confirm both people hear each other. The AI session shuts down after the recipient is validated and publishes a microphone track; the caller's button says **Teammate joined**. The room is kept for the two people.
8. End the test in both browser sessions and turn availability off if appropriate.
9. Repeat with **Decline**, an unavailable recipient, an expired request, and a caller hanging up before acceptance. The agent remains available if no recipient joins. Offer a message/appointment instead of promising a completed transfer. One transfer attempt is allowed per test call; start a new call to retry.

Requests expire after 90 seconds. The recipient checks manually; no timer polls the API. Tokens are restricted to the accepted room and recipient, expire after 90 seconds, cannot change their signed participant attributes, and cannot administer the room. Provider connection/microphone errors are surfaced; an accepted request can be retried within its lifetime if connection failed. A successful handoff cannot be reused for another call.

Availability here is an explicit user toggle, not live phone/Teams presence. This test does not yet implement phone-number transfer, warm consultation, multi-destination hunt groups, automatic retries, transfer operating hours or Slack approval. It does not modify the real telephone/SIP path.

## Past appointment deletion

Deleting a past DeskRoute booking now deletes its linked Google event first, then removes its local history row. The original saved Google account and calendar are used even if the current booking destination changed. Already-deleted Google events are safe to retry. A disconnected account or Google error retains the local row and asks the user to reconnect/retry. A Google success followed by a database failure can leave the local row temporarily; retry finishes cleanup. Only appointments whose end time has passed can use this history endpoint.

The calendar cache is cleared for that event and refreshed after success. This affects a booking linked to Google; arbitrary personal Google events still have no DeskRoute delete action. Call records and transcripts remain separate.

## Deployment order

1. Finish this local two-browser acceptance check.
2. Deploy a **stable staging website and HTTP API on Vercel Pro**, with the worker on a persistent runtime or LiveKit's agent hosting. Configure a stable HTTPS origin, CORS, Supabase redirect URLs and the Google Calendar OAuth callback for staging. Verify refreshes of `/workspaces` and other client routes.
3. Invite teammates and test manager/member isolation, invitations, calendars, notifications and browser handoff. While Google OAuth remains in Testing, add the authorized testers to the Google project's audience.
4. Integrate a temporary number/SIP route with Mike's provider. Test real inbound audio, caller ID, transfer support, no answer and hang-up behavior. Only then plan the customer's existing-number forwarding or porting.

The deployment adapter/rewrite configuration and hosted environment are still a separate deployment task; this change does not deploy the app. Vercel HTTP functions have finite invocation lifetimes, so keep this persistent LiveKit worker separate ([Vercel limits](https://vercel.com/docs/functions/limitations), [LiveKit agent deployment](https://docs.livekit.io/deploy/agents/)). Do not add background polling to make the transfer test feel live; a later production notification transport should be chosen from measured requirements.

## Verification

Unit/API tests cover selected-workspace authorization, member restrictions, owner calendar access, verified-email invitations, transfer token scope, expiration/caller absence and past-event deletion failures. Local PostgreSQL tests cover invitation races, role protection, removal, per-member read receipts, routing ownership, expired requests, RLS and upgrade preservation. UI inspection uses disposable local fixtures with the production components; it is not proof of real cross-device audio or real Google deletion.


Release checks: 242 unit/API/voice tests and 44 PostgreSQL integration tests passed. Type checking, lint and production web build passed. Light/dark and mobile workspace layouts were inspected with disposable UI fixtures. Web design contracts retain the same five pre-existing failures (55 passing); the checks were not weakened. The configured Supabase upgrade preserved existing account workspaces, calendar connections and booking records. No real call or Google event deletion was performed during automated validation.
