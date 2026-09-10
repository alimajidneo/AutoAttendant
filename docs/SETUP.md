> **Integration update (2026-09-10):** Apply migration `0008_curved_nebula`, configure the Microsoft and Slack credentials in sections 8 and 9, then restart API and voice. Existing users, workspaces, Google accounts, calendars, and appointments are preserved.

> **Current work (2026-09-09):** Follow [ROADMAP.md](ROADMAP.md) for the agreed calendar-first scope and [CALENDAR_TESTING.md](CALENDAR_TESTING.md) for the multiple-account acceptance steps. Google connection setup now uses a short-lived HttpOnly browser cookie and PKCE; restart the API and voice worker after updating, then start a fresh connection from DeskRoute. No new credentials or database migration are required by this hardening batch.

# DeskRoute setup — USA customer handover

These instructions are for your checkout at `/home/ali/NewProjects/AutoAttendant/deskroute-app`. The `AutoAttendant` folder is the workspace; **`deskroute-app` inside it is the application root**.

Current decision: use **Supabase PostgreSQL + Supabase Auth + LiveKit**. Google sign-in supports customer administrators; no account, business, calendar, timezone, or phone number is hard-coded to the developer. No Clerk account is needed.

Current implementation: phone-free onboarding, Supabase Google sign-in, API owner verification, multiple directly connected Google and Microsoft accounts, encrypted Calendar token renewal, mixed-provider availability and booking, selected-channel Slack alerts, exact-time booking, general 30-minute appointments, dashboard cancellation, explicit Calendar reconciliation, and a month view of selected calendars. Login identities and external connections are separate. Teams presence and Slack transfer approval are not part of this batch.

## Saved credential verification — 2026-09-08

- Database URLs match across core migrations, API, and voice. LiveKit URL/key/secret match across API and voice. Secret values were not printed.
- Filled blank local defaults: API `PORT=8080`, dashboard origin `http://localhost:5173`, and voice `LLM_PROVIDER=livekit`.
- LiveKit credentials verified through a read-only room-list request; no room, worker session, or phone number was created.
- Supabase database login and initial migrations were verified using the application's shared TLS configuration: client-to-pooler connection encrypted with certificate/hostname validation. PostgreSQL 17.6.
- The pooler's downstream database session reports `pg_stat_ssl.ssl=false`; this is distinct from the verified TLS socket between this app and the pooler. Do not describe it as end-to-end TLS through the pooler.
- Runtime and Drizzle migrations now share verified remote TLS configuration. Supabase's public CA is bundled with the backend; `DATABASE_POOL_MAX` defaults to 3 per process and accepts 1–20.
- Supabase Auth, callback configuration, Calendar connection, and a live browser booking were accepted. Hosted deployment and US telephone acceptance remain.

## Provider setup completed — 2026-09-08

Configured in the visible browser with the user's authorization:

| Setting | Verified value/status |
| --- | --- |
| Google Cloud project | DeskRoute Dev (`deskroute-dev`), organization `neodym.ai` |
| OAuth app | DeskRoute; External audience; Testing status |
| Support/developer contact | ali@neodym.ai |
| Test user | ali@neodym.ai |
| OAuth client | DeskRoute Web; Web application |
| JavaScript origin | `http://localhost:5173` |
| Google redirect | `https://kpwrmksedtcncrnltdro.supabase.co/auth/v1/callback` |
| Local Calendar connection redirect | `http://localhost:8080/api/calendar/oauth/callback` |
| Google Calendar API | Enabled |
| Declared identity scopes | `openid`, `userinfo.email`, `userinfo.profile` |
| Declared Calendar scopes | `calendar.events`, `calendar.calendarlist.readonly`, `calendar.freebusy` (under `https://www.googleapis.com/auth/`) |
| Supabase project | deskroute-dev (`kpwrmksedtcncrnltdro`) |
| Supabase Google provider | Enabled; actual Google credentials saved directly in provider settings |
| Supabase Site URL | `http://localhost:5173` |

The Google client secret is stored in Supabase, not this document. No billing activation or paid trial was performed. Google billing was previously verified disabled for this project.

The broad `calendar` scope was not saved. The narrower scope set above is configured and supports the current event listing, creation, and deletion behavior. Scope declaration alone does not authorize access to anyone's calendar.

Remaining: deploy the web/API, move the voice worker to LiveKit Cloud, complete Google production OAuth readiness, and select and verify US telephone routing. Existing setup steps below are reference instructions; do not create duplicate OAuth clients or projects.

### Google accounts during testing and production

The current `deskroute-dev` OAuth application is **External** with publishing status **Testing**. Calendar authorization is therefore limited to Google accounts listed as test users, and Calendar refresh tokens normally expire seven days after consent. This is suitable only for development.

Before customers connect their own Google accounts:

1. Deploy DeskRoute at a stable HTTPS domain.
2. Publish a real product homepage and privacy policy on a verified domain. Describe the Calendar data DeskRoute reads, writes, stores, and deletes.
3. Create or select the production Google Cloud project, configure the audience as **External**, and add the production domain and Supabase callback. Keep the development project for testing.
4. Declare only the scopes used by the product: identity, Calendar event management, calendar-list read access, and free/busy access.
5. Change the production app to **In production** and submit the brand and sensitive Calendar scopes for Google verification, including the required scope explanations and demonstration.
6. Configure the production Supabase Google provider and URL allowlist with the approved client and stable DeskRoute callback.
7. Test with a Google account that is not a project test user before customer launch. A customer's Google Workspace administrator may still restrict third-party applications.

The deployment operator performs this work. Customers should only choose **Continue with Google**, approve the requested access, and select their calendars inside DeskRoute.

### Current service costs

| Service | Development now | Expected production boundary |
| --- | --- | --- |
| Google OAuth and Calendar API | No current bill; Google billing is disabled on `deskroute-dev`. Standard Calendar API use under the published threshold has no additional charge. | Monitor Google's quota and pricing notices before launch. |
| Supabase | Free plan: $0 while within its included database, active-user, storage, and bandwidth limits. Free projects can pause after inactivity and do not include production backup guarantees. | Pro currently starts at $25/month and includes daily backups and a Micro compute credit. |
| LiveKit | Build plan is $0/month and currently includes $2.50 of inference credit. Voice tests consume that credit even when the invoice remains $0. | Ship currently starts at $50/month. Inference, agent sessions, telephony, recordings, and data transfer are metered. |
| Vercel | Not deployed, therefore currently $0 for this project. | The intended Pro plan currently has a $20/month platform fee with $20 of usage credit for one deploying seat; excess usage is metered. |
| Telephone carrier | Not connected, therefore currently $0. | A US number, inbound minutes, transfer call legs, SMS, recording, and taxes can add separate charges. Select the carrier after the VoIP discovery test. |

The current voice pipeline uses GPT-4.1 mini, AssemblyAI Universal-3.5 Pro Streaming, and Cartesia Sonic 3.5 through LiveKit Inference. At current published Build/Ship list prices, those components total roughly `$0.039/minute` of conversational inference before the small summary-model usage, media, recording, or telephone costs. Treat this as a planning estimate; the LiveKit usage dashboard is the billing record.

## Delivery requirements

Build the same application for testing and customer operation. Initial testing uses free allowances where available; handover requires verified hosting, actual provider costs, and a working US telephone route. A local browser demo is an intermediate check, not the delivery target.

Customer onboarding must collect business identity, an IANA timezone with daylight-saving behavior, working hours, services, calendar authorization, and telephone routing through supported settings. Customers must not edit source code, replace authentication providers, or manually migrate their data to use the product. Keep each customer's data and credentials isolated.

Supabase Auth replaces the inherited Clerk integration. Verify sign-in and Calendar access before customer onboarding. Normal deployment configuration and versioned database upgrades remain necessary engineering work; the handover must not depend on a later architecture replacement. The delivery owner runs and verifies these steps.

This guide contains no invented credentials or proposed environment variables. Real secrets must come from the selected provider and remain in local/server configuration. Blank template entries mean setup is incomplete; they are not working defaults.


### Latest code verification

Latest automated result for the integration batch: 255 unit/API/voice tests and 44 disposable PostgreSQL integration tests pass. Typecheck, lint, and production build pass. The complete migration chain passed locally, and migration `0008_curved_nebula` was applied successfully to the configured Supabase development database. Web tests remain 61 passing with the same five pre-existing design-contract failures. Live Microsoft and Slack acceptance remains. Real Google sign-in, two Google accounts, browser voice, and a Calendar booking were manually verified earlier.

## 1. Find and edit the environment files

Files starting with a dot are hidden by many file browsers. In the Ubuntu Files app, press **Ctrl+H** to show them. In an editor, use **Open File** and paste the full path below.

The `.env.example` files are templates. The `.env` files hold your actual local settings. I created the four local files from the templates on 2026-09-08, preserving any existing files. You can edit them directly now. Templates now use Supabase Auth. Existing local files preserve saved database and LiveKit credentials.

| Purpose | Template | File to edit |
| --- | --- | --- |
| Database migrations | [core template](/home/ali/NewProjects/AutoAttendant/deskroute-app/packages/core/.env.example) | [core .env](/home/ali/NewProjects/AutoAttendant/deskroute-app/packages/core/.env) |
| Backend API | [API template](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/api/.env.example) | [API .env](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/api/.env) |
| Website | [web template](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/web/.env.example) | [web .env.local](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/web/.env.local) |
| Voice worker | [voice template](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/voice/.env.example) | [voice .env](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/voice/.env) |

If you prefer the terminal, first run:

```sh
cd /home/ali/NewProjects/AutoAttendant/deskroute-app
pwd
ls -la packages/core/.env*
nano packages/core/.env
```

`pwd` should end in `/AutoAttendant/deskroute-app`. In nano, save with **Ctrl+O**, press **Enter**, and exit with **Ctrl+X**. Do not include a trailing backtick in a filename; backticks in documentation only format code.

Use one `NAME=value` entry per line. Fill the existing entry with the actual provider value rather than adding duplicate entries. Keep secrets in these local files; they are ignored by Git. Do not put server secrets into the website's `VITE_*` variables. Restart a running process after changing its environment file.

## 2. Create Supabase and save the database connection

### Create the project

1. Open [Supabase Dashboard](https://supabase.com/dashboard) in your browser and sign up or sign in.
2. Create an organization if asked. Choose the **Free** plan.
3. Choose **New project** and select that organization.
4. Name the project `deskroute-dev`.
5. Generate a strong database password and save it privately. This is the database password, separate from your Supabase login password.
6. Choose a nearby available region. You can share the region name if you want help choosing; no paid region/network add-on is needed for this setup.
7. Create the project and wait for provisioning to finish.

### Copy the right connection string

1. Inside the project, click **Connect**.
2. Find the PostgreSQL connection string/URI controls. If using the **ORM** tab, select **Drizzle**. Copy the **connection string**, not the ORM configuration snippet; this repo already configures Drizzle.
3. For this local setup, select **Session pooler** on port **5432**. This works on IPv4 without buying an IPv4 add-on. A direct connection is also suitable if your network supports IPv6.
4. Copy the entire URI shown by your dashboard. Keep its exact hostname and username; do not construct them from the project display name.
5. Replace `[YOUR-PASSWORD]` with your database password. If the dashboard offers password insertion, use it. Otherwise URL-encode reserved characters in the password only: for example `@` becomes `%40`, `#` becomes `%23`, and `/` becomes `%2F`. Do not use an online password encoder.

In the environment file, set `DATABASE_URL` to the complete connection string copied from your project. Keep the value on one line and wrap it in double quotes. No sample hostname or password should be used.

Put your actual `DATABASE_URL` line in all three files:

- [packages/core/.env](/home/ali/NewProjects/AutoAttendant/deskroute-app/packages/core/.env)
- [apps/api/.env](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/api/.env)
- [apps/voice/.env](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/voice/.env)

Do not use the HTTPS project URL or a Supabase API key as `DATABASE_URL`. This application connects from its backend through PostgreSQL. [Official connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres).

### Keep the Data API disabled

**Completed:** you confirmed that the Data API is disabled. Keep it disabled: DeskRoute accesses application data through its own backend and Drizzle. Supabase Auth uses a separate authentication API and can still be used. The [Supabase API security guide](https://supabase.com/docs/guides/api/securing-your-api) explains the Data API controls.

**Checkpoint:** the project exists and the database URI is saved locally in the three files. You can tell me “Supabase is ready” and share the project name or dashboard link. Do not send the URI or password.

**Connection verified:** database credentials, client-to-pooler TLS, PostgreSQL version, and a small runtime pool are configured. Applying the application schema remains pending. If a certificate error occurs, do not disable certificate verification. The migration command is documented in section 6 for use after that work.

## 3. Configure Supabase Auth for Google login

Use the same Supabase project as the database. We need customer administrator login, session handling, logout, verified backend requests, and customer ownership checks. Callers do not need accounts. Additional staff roles and login methods should be added only when required by the customer workflow.

### 3A. Choose the account and project owner first

Use a Google account controlled by the business operating this service. Your sign-in email, the Google Cloud organization, and the customer's calendar are separate things.

| Situation | Account/organization to use |
| --- | --- |
| You will host and operate the service for customers | Your own business account and organization. Customers later connect their own calendars through the app. |
| You are delivering a system the customer will own and operate | The customer's organization, with your individual account invited to work on the project. |
| You are doing independent development and have no managed organization | An account you control, with **No organization** if offered. |
| The only organization shown belongs to an unrelated employer | Do not put this project there. Switch to the intended business account. |

To avoid an ownership transfer later, choose the intended production owner before creating its project. If the customer will own everything but has not supplied organization access, their administrator needs to provide that access first. Independent development may continue separately; do not assume its account will become customer production automatically.

### 3B. Create the Google Cloud project: each field

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Check the profile icon at the top right. Switch accounts if necessary.
3. Open the project selector near the top left, then **New project**. Alternatively use [Manage resources](https://console.cloud.google.com/cloud-resource-manager) → **Create project**.
4. Fill the form using the table below.

| Field | Meaning | Action |
| --- | --- | --- |
| **Project name** | Readable label | Enter `DeskRoute` for this product project. |
| **Project ID** | Permanent unique identifier | Keep Google's generated ID. It is not a password. |
| **Organization** | Managed business controlling the project | Select the intended business from 3A; select **No organization** only for a standalone project. |
| **Parent resource / Location / Parent organization** | Organization or folder immediately containing the project | Select the same organization as the parent, unless its administrator requires a particular folder. With **No organization**, retain the standalone/no-parent selection. |
| **Billing account**, if shown | Account charged for billable resources | Do not add billing for this OAuth/Calendar-only setup. If enforced by an organization, ask its administrator about that policy. |

5. Click **Create**, wait, then select the new project in the project selector.

**Organization and Parent are not two companies you must create.** The parent is a location in the selected organization's hierarchy. It is unrelated to the customer's US state or your computer's location. [Google project creation](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects).

If **No organization** is missing, do not invent an organization name or buy Workspace just to fill the field. Check which account is signed in. If the correct managed organization is required but unavailable or creation is denied, ask its administrator for project-creation access in the intended organization/folder. The relevant permission is `resourcemanager.projects.create`.

**Cost:** standard Calendar API use is available at no additional cost. This setup does not deploy Google hosting or compute. A Cloud free-trial signup is separate from creating this OAuth configuration. If the console insists on payment details, check the page and organization policy before continuing. [Calendar usage and costs](https://developers.google.com/workspace/calendar/api/guides/quota).

**Checkpoint:** the project selector shows `DeskRoute`, under the intended owner. No compute, storage, or hosting resources have been created.

### 3C. Configure the consent screen

This is the screen customers see when granting access. Use real business contact details; do not publish invented website or policy links.

1. With the project selected, search the console for **Google Auth Platform**. Older navigation calls this **APIs & Services → OAuth consent screen**.
2. Open **Overview** and choose **Get started** if shown. If already configured, edit the **Branding**, **Audience**, and **Contact Information** sections instead.
3. For **App name**, enter `DeskRoute` (or your actual customer-facing product name).
4. For **User support email**, select a monitored email belonging to the service operator.
5. For **Audience**, choose **External** for a product that customers outside the project's organization will use. Choose **Internal** only for a deployment intentionally restricted to users in that Google organization. Having a work email does not itself mean Internal is appropriate.
6. Enter a monitored developer contact email. Review the policy acknowledgement and save/create the configuration.
7. In **Audience**, keep the app in **Testing** during development. Under **Test users**, choose **Add users**, enter the exact Google account you will use to test login/calendar access, and save.
8. In **Data Access**, choose **Add or remove scopes**. Select the basic identity scopes: `openid`, `https://www.googleapis.com/auth/userinfo.email`, and `https://www.googleapis.com/auth/userinfo.profile`. Save/update the selection.

Branding fields required for publication must contain real deployed URLs and verified domains. Complete production publication and any required verification before customer handover. [Google consent setup](https://developers.google.com/workspace/guides/configure-oauth-consent).

**Checkpoint:** consent configuration exists, your test account is listed, and the audience will permit the intended customer population when published.

### 3D. Obtain the Supabase callback

1. Keep Google Cloud open in one tab. Open [Supabase Dashboard](https://supabase.com/dashboard) in another.
2. Select the Supabase project already holding your database.
3. Open **Authentication**, then **Sign In / Providers** (sometimes labeled **Providers**).
4. Open **Google** and locate the displayed callback/redirect URL.
5. Copy that exact URL for Google's next step. Do not substitute localhost, a database URI, or the Supabase dashboard address.
6. Keep this provider page open; you will return with the Google client credentials.

### 3E. Create the Google OAuth client

1. Return to the correct Google Cloud project.
2. Open **Google Auth Platform → Clients → Create client**. Older navigation: **APIs & Services → Credentials → Create credentials → OAuth client ID**.
3. Choose **Web application** for application type.
4. Name the client `DeskRoute Web`.
5. Under **Authorized JavaScript origins**, click **Add URI** and enter `http://localhost:5173` for local development.
6. Under **Authorized redirect URIs**, add both redirects used locally:
   - the exact Supabase callback copied in 3D, for DeskRoute login;
   - `http://localhost:8080/api/calendar/oauth/callback`, for connecting one or more Calendar accounts.
7. Click **Create**.
8. Copy the resulting **Client ID** and **Client secret** directly into the matching fields on Supabase's Google provider page. If the secret is shown only once, save it privately before closing the dialog.
9. Enable the Google provider and click **Save** in Supabase.

The Google client ID/secret belong in Supabase's Google provider settings. They are not Supabase API keys and do not belong in the website's environment file. [Supabase Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google).

**Checkpoint:** Google provider settings are saved with the credentials from `DeskRoute Web`; its Google redirect exactly matches the Supabase callback.

### 3F. Configure the application return address

1. In Supabase, open **Authentication → URL Configuration**.
2. Set **Site URL** to `http://localhost:5173` for local development and save.
3. Leave new application callback allowlist entries until the actual callback route is implemented and verified. No guessed route should be added.

There are three local redirect steps. Google returns login authorization to Supabase, Supabase returns login to `http://localhost:5173/auth/callback`, and separate Calendar authorization returns directly to `http://localhost:8080/api/calendar/oauth/callback`. Add the web callback in Supabase → Authentication → URL Configuration. Add both Google-facing callbacks to the Google OAuth client.

For customer deployment, use the real HTTPS application origin and verified callback in Google/Supabase, complete production OAuth readiness, and remove development-only URLs from production configuration. This is environment configuration using the same architecture, not a customer-required provider or data migration.

### Prepare the app configuration

Find your **Project URL** and **Publishable key** in the Supabase project's Connect/API-key settings. The URL starts with `https://`; a current publishable key starts with `sb_publishable_`. Neither is the PostgreSQL connection string. Do not use a secret key or `service_role` key in the browser.

**Fill the supported environment variables** (do not paste secrets into chat):

1. Open Supabase → your DeskRoute project → Settings → API Keys. Copy the **publishable key** (or legacy `anon` key if using that section). Do not use `service_role` or a secret key in the browser.
2. Put it in `SUPABASE_PUBLISHABLE_KEY` in `apps/api/.env` and `apps/voice/.env`, and in `VITE_SUPABASE_PUBLISHABLE_KEY` in `apps/web/.env.local`.
3. Set `SUPABASE_URL` in both server files and `VITE_SUPABASE_URL` in the web file to the project's HTTPS URL. These real project URLs are already filled in your local files.
4. In Google Cloud → Google Auth Platform → Clients, open the same Web client configured in Supabase. Copy its client ID and client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in **both** server files. The client ID is already filled locally. These values let the worker renew Calendar access after the dashboard closes; basic sign-in does not require the server's Google settings.
5. `TOKEN_ENCRYPTION_KEY` must be the same 64-character hexadecimal key in both server files. A random key has been generated in your local files without displaying it. For a new deployment, generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and save it in the deployment's secret manager. Preserve this key in backups; replacing it makes existing Calendar credentials unreadable.
6. Keep `PORT=8080`, `DASHBOARD_ORIGINS=http://localhost:5173`, `PUBLIC_API_URL=http://localhost:8080`, and `VITE_API_URL=http://localhost:8080/api` for local use.
7. In Supabase → Authentication → URL Configuration, add exactly `http://localhost:5173/auth/callback` to Redirect URLs. In the Google client, keep the Supabase `/auth/v1/callback` URI and also add `http://localhost:8080/api/calendar/oauth/callback`.
8. Restart the API, worker, and web server after changing environment files.

For customer deployment, use customer-approved project credentials and HTTPS origins. Keep all server secrets out of `VITE_*`, Git, and screenshots. No Clerk configuration is needed.

**Checkpoint:** after the migration and startup below, Google sign-in returns to DeskRoute onboarding. Calendar permissions are requested later under Settings → Connections; Google login alone does not connect Calendar.

## 4. Create LiveKit and save the voice credentials

The API currently requires LiveKit credentials even before the voice worker starts.

1. Open [LiveKit Cloud](https://cloud.livekit.io/) and create an account.
2. Create a project named `deskroute-dev` on the free **Build** plan.
3. Open project settings and find **API keys**. Create a key if none is available.
4. Save the **API key**, **API secret**, and project **WebSocket URL**. The URL begins with `wss://`.
5. Open the project usage/billing screen and check the available inference credits before running voice tests. Stay on the free plan for initial testing.

Fill these same three entries in both the [API file](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/api/.env) and [voice file](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/voice/.env):

Set `LIVEKIT_URL` to the actual WebSocket URL, `LIVEKIT_API_KEY` to the actual API key, and `LIVEKIT_API_SECRET` to its matching secret. Copy these from your project; do not invent values.

In the voice file, also set:

```dotenv
LLM_PROVIDER=livekit
```

For initial voice testing, set these values in `apps/voice/.env`:

```env
LLM_PROVIDER=livekit
LLM_MODEL=openai/gpt-4.1-mini
SUMMARY_LLM_MODEL=openai/gpt-4.1-mini
```

LiveKit lists GPT-4.1 mini in its [supported inference models](https://docs.livekit.io/agents/models/inference/). `livekit` is the provider, not a model ID. Both model values are required: the first handles conversations, the second summarizes completed calls. These settings use LiveKit Inference and its usage credits; no separate OpenAI key is required. Model availability is documented; a successful live conversation still needs verification.

Leave every `R2_*` and `OPENROUTER_*` entry blank. R2 is optional recording storage; OpenRouter is an alternative model provider. Neither is needed for our first setup. Do not purchase a phone number or create a SIP trunk.

The agent is already implemented in this repository. The [LiveKit voice quickstart](https://docs.livekit.io/agents/start/voice-ai/) is background reference, not a request to create another starter app. Free allowances do not mean unlimited inference; check [LiveKit pricing](https://livekit.com/pricing) and your actual dashboard allowance.

**Checkpoint:** API and voice have matching LiveKit credentials. The worker is still off; no voice usage has been started by these file edits.

## 5. Check the local tools

Open a terminal and run:

```sh
cd /home/ali/NewProjects/AutoAttendant/deskroute-app
node --version
pnpm --version
```

This checkout was verified with Node **22.23.1** and pnpm **10.34.5**. Dependencies are already installed in this workspace. If either command is missing, report the command and error rather than reinstalling the project.

On a fresh checkout, install with `pnpm install --frozen-lockfile`. The initial installation here skipped lifecycle scripts; native voice assets must still be checked before voice startup.

These checks do not call paid providers or require a connected database:

```sh
pnpm test
pnpm test:web
pnpm typecheck
pnpm lint
pnpm build
```

Expected: commands finish successfully. Last baseline: 176 unit tests, typecheck, lint, and build passed. A successful build does not prove that cloud credentials or booking work.

## 6. Database verification and first app startup

Check that `packages/core/.env` points to the intended project, then run the command below. Drizzle applies only migrations that are not already recorded. Migration `0008_curved_nebula` adds one encrypted Slack installation per workspace. Microsoft reuses the existing provider-neutral calendar-connections table, so no Microsoft-specific credential table is added. No manual table design or pasted SQL is needed.

The repository's migration command, run from the application root, is:

```sh
pnpm db:migrate
```

It reads `packages/core/.env` and modifies that database. Run it once after receiving these changes and expect `migrations applied successfully`. Do not run `pnpm test:int` against this development project; the integration fixtures delete table contents and need a separate disposable database.

After filling the environment files and applying migrations, open two terminals.

Terminal 1 — backend:

```sh
cd /home/ali/NewProjects/AutoAttendant/deskroute-app
pnpm dev:api
```

Terminal 2 — website:

```sh
cd /home/ali/NewProjects/AutoAttendant/deskroute-app
pnpm dev:web
```

Open [the local app](http://localhost:5173) in your normal browser. Use `localhost` consistently with the origin setting above.

1. Sign in with your Google test account through Supabase Auth.
2. Enter your assistant's initial business/profile details and timezone.
3. Select **Finish setup**. There should be no phone selection step.
4. Open settings and save a small change.
5. Reload the page, restart the API, and verify that change remains saved.

That is the first account-backed milestone. Keep the voice worker off until the calendar and model checks below are ready. Avoid `pnpm dev` at this stage because it starts API, web, and voice together.

## 7. Google Calendar and voice — next milestone

Basic login does not automatically grant calendar access. Use a separate calendar such as `DeskRoute Test`, so test appointments are easy to identify.

Use the same Google Cloud project and OAuth client configured in section 3:

1. Under **APIs & Services → Library**, enable **Google Calendar API**.
2. The Google OAuth consent configuration now declares `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and `https://www.googleapis.com/auth/calendar.freebusy`. These support event management, calendar listing, and availability without permission to share or delete entire calendars. The app consent request must use this same set; keep your account in the test-user list during development.
3. Keep the same OAuth client credentials in Supabase's Google provider settings and the API and voice `.env` files. The Google client must allow both the Supabase login callback and `http://localhost:8080/api/calendar/oauth/callback`.
4. In Google Calendar, use **Other calendars → + → Create new calendar** to create `DeskRoute Test`.
5. Use **Settings → Connections → Google Calendar → Connect**. Choose any test-user Google account, approve the requested Calendar permissions, choose a booking calendar and conflict calendars, then save. A Calendar account does not become a DeskRoute login administrator.

Google offline access, encrypted refresh-token storage, access-token renewal, and revoked-permission handling are implemented. Supabase session tokens and Google Calendar tokens serve different purposes. No manual token copying into environment files is required.

Calendar access after closing the dashboard, token refresh, calendar listing, and booking were verified locally.

### Add more calendars

In DeskRoute, open **Settings → Connections → Google Calendar → Manage**. Choose one writable **Booking calendar**. This is the only calendar where the receptionist creates appointments. Under **Calendars that block free time**, enable every calendar that should make a time unavailable, then choose **Save calendar settings**.

To include another Gmail or Google Workspace account:

1. Choose **Connect account** in the Google Calendar panel.
2. Google's account chooser appears. Select the additional account and approve access.
3. Repeat for each company account. While the OAuth app is in Testing, every account must first be listed under Google Auth Platform → Audience → Test users.
4. Pick one writable calendar from any connected account as the **Booking calendar**.
5. Turn on every calendar across all connected accounts that should block free time, then save.

DeskRoute stores a separately encrypted refresh token for each Calendar account. Disconnecting one account does not sign the owner out of DeskRoute or revoke the other accounts. The voice worker queries each selected account in parallel, merges busy ranges, and creates appointments only in the designated booking calendar. A shared Google Calendar still appears and can be selected, but sharing is no longer required.

Before starting voice on a fresh machine, download its native model assets. The worker's asset download script does not load `.env` itself, so the explicit local command is:

```sh
pnpm -F voice exec tsx --env-file=.env src/worker.ts download-files
```

After those checks, start the worker in a third terminal from the application root:

```sh
pnpm dev:voice
```

Use the dashboard browser test, allow microphone access, and make a short test conversation. Stop the worker with **Ctrl+C** when finished. A browser test creates no call recording/log entry, but booking tools write real appointments and calendar events. Verify both records before calling the milestone complete.

## 8. Connect Microsoft Outlook and Microsoft 365

DeskRoute uses one Microsoft Entra application owned by the operator. Customers connect their own personal Outlook.com or organizational Microsoft 365 accounts through that application. Connecting a Microsoft account does not change the user's DeskRoute/Supabase login.

### 8A. Create the Entra application

1. Sign in to [Microsoft Entra admin center](https://entra.microsoft.com/) with the Neodym work account that should own the development integration.
2. Open **Identity → Applications → App registrations**. If the left navigation differs, search for **App registrations** at the top.
3. Select **New registration**.
4. Enter `DeskRoute Development` as the name.
5. Under **Supported account types**, select **Accounts in any organizational directory and personal Microsoft accounts**. This exact choice permits both work/school Microsoft 365 and personal Outlook.com accounts.
6. Under **Redirect URI**, choose the **Web** platform and enter exactly:

   ```text
   http://localhost:8080/api/microsoft/oauth/callback
   ```

7. Select **Register**.
8. On **Overview**, copy the **Application (client) ID**. Do not copy the Object ID or Directory (tenant) ID.

### 8B. Add only the calendar permission DeskRoute uses

1. In the new app, open **API permissions**.
2. Keep the delegated `User.Read` permission created by Microsoft.
3. Select **Add a permission → Microsoft Graph → Delegated permissions**.
4. Search for `Calendars.ReadWrite`, select it, and choose **Add permissions**.
5. Do not add application permissions, tenant-wide calendar access, Teams calling, chat history, mail, contacts, or files.
6. For a personal Outlook account, the user can normally consent during connection. A Microsoft 365 organization may require an administrator to approve the delegated permissions under its own tenant policy. Do not grant tenant-wide admin consent just to bypass a policy without the customer's administrator.

DeskRoute also requests the standard delegated `openid`, `profile`, `email`, and `offline_access` scopes during sign-in. `offline_access` supplies a refresh token so the receptionist can check the calendar while the dashboard is closed. Refresh tokens are encrypted in PostgreSQL, rotated when Microsoft returns a replacement, and never sent to the website.

### 8C. Create and save the client secret

1. Open **Certificates & secrets → Client secrets → New client secret**.
2. Use the description `DeskRoute local development` and choose the shortest expiry that fits the pilot.
3. Select **Add**.
4. Copy the secret's **Value** immediately. Microsoft shows the value once. The **Secret ID** is not the client secret.
5. In both [apps/api/.env](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/api/.env) and [apps/voice/.env](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/voice/.env), set `MICROSOFT_CLIENT_ID` to the Application (client) ID and `MICROSOFT_CLIENT_SECRET` to the client secret Value. Replace the blank entries already present; do not add duplicates.
6. Keep `TOKEN_ENCRYPTION_KEY` unchanged and identical in those two files. Do not put the Microsoft secret in `apps/web`, Git, chat, screenshots, or the Supabase browser key settings.
7. Restart `pnpm dev:api` and `pnpm dev:voice`. The website does not need Microsoft credentials.

### 8D. Connect and verify an account

1. Apply migration `0008_curved_nebula` with `pnpm db:migrate` if it has not already been applied.
2. In DeskRoute, open **Settings → Connections → Calendars → Manage**.
3. Select **Microsoft**. Choose the Outlook.com or Microsoft 365 account and approve the requested Calendar access.
4. Back in DeskRoute, choose one writable **Booking calendar** and enable every Google/Microsoft calendar that should block free time. Select **Save calendar settings**.
5. Create a clearly named test event in Outlook at a known time. Refresh the DeskRoute Appointments page and verify that event appears.
6. Ask the browser voice agent for that exact time; it must report the time unavailable.
7. Book a different free time and verify the new event appears in the selected Outlook calendar.
8. Delete that event in Outlook, choose **Refresh** in DeskRoute, and verify the DeskRoute appointment becomes cancelled.

Repeat with a second Microsoft account and then with one Google plus one Microsoft calendar. A successful OAuth screen alone is not acceptance; conflict blocking, booking, deletion, recurrence, all-day events, and daylight-saving boundaries still need live checks.

Signing in to Microsoft Teams is not required for these calendar steps. Teams uses the same Microsoft identity platform, but presence and transfer-approval features need separate permissions and organizational testing. They remain disabled until the calendar path is accepted.

For production, add the deployed HTTPS API callback as another **Web** redirect URI and set the deployed API's `PUBLIC_API_URL` to that origin. Keep the local callback only in the development app. The production registration should use Neodym's verified publisher/domain details so customer administrators can evaluate the consent request.

## 9. Connect Slack notifications

The first Slack integration sends privacy-minimal notifications to one owner-selected channel. It does not read message history, direct messages, user profiles, or calendar contents. It does not yet approve or perform a live call transfer.

### 9A. Create the Slack app

1. Sign in to [Slack API apps](https://api.slack.com/apps) with the account that can install apps in the test Slack workspace.
2. Select **Create New App → From scratch**.
3. Enter `DeskRoute` as the app name and choose the Slack workspace used for testing.
4. Open **OAuth & Permissions**.
5. Under **Redirect URLs**, add exactly:

   ```text
   http://localhost:8080/api/slack/oauth/callback
   ```

6. Under **Bot Token Scopes**, add only:
   - `chat:write` — post the selected alerts.
   - `channels:read` — list public channels the bot has joined.
   - `groups:read` — list private channels the bot has joined.
7. Do not add message-history, direct-message, users, files, admin, or workspace-wide posting scopes. DeskRoute intentionally does not request `chat:write.public`.
8. Open **Basic Information → App Credentials**. Copy the **Client ID** and **Client Secret**. Do not share the Signing Secret; this alert-only release has no inbound Slack actions.

### 9B. Save, install, and select a channel

1. In [apps/api/.env](/home/ali/NewProjects/AutoAttendant/deskroute-app/apps/api/.env), set `SLACK_CLIENT_ID` to Slack's Client ID and `SLACK_CLIENT_SECRET` to Slack's Client Secret. Replace the blank entries already present; do not add duplicates.
2. Keep the API's existing `TOKEN_ENCRYPTION_KEY`; it encrypts the installed bot token before storage.
3. Restart `pnpm dev:api`.
4. In DeskRoute, open **Settings → Connections → Slack → Connect Slack**.
5. Choose the test Slack workspace and approve the three displayed bot permissions.
6. In Slack, open the intended channel, open the channel details, choose **Integrations → Add apps**, and add `DeskRoute`. For a private channel, a channel member must invite the app.
7. Return to DeskRoute and select **Check again**. Choose the channel.
8. Turn on only the alert types the team wants and select **Save**.
9. Select **Send test**. Verify that Slack receives exactly one generic DeskRoute connection message.

Booking, request, cancellation, caller-question, and call-error alerts are event-driven; DeskRoute does not poll Slack or Teams in the background. The messages do not include a caller's name, phone number, transcript, recording, calendar event title, or appointment time. This reduces disclosure in a shared channel.

For production, add the deployed HTTPS Slack callback, update `PUBLIC_API_URL`, and configure Slack app distribution for customer workspaces. Each DeskRoute workspace stores one encrypted Slack installation and its own selected channel. Disconnecting Slack deletes the local credential immediately and requests Slack token revocation.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `packages/core/.env.example` not found | Run `pwd`; enter the nested `deskroute-app` directory. Use Ctrl+H for hidden files. |
| `Invalid environment variables` | Fill the variable named in the error in the correct process's file, then restart. Blank required values cannot start the service. |
| `DATABASE_URL` seems correct but login fails | Use the database password, URL-encode reserved password characters, and preserve the pooler's exact username. |
| Database network unreachable | Check project provisioning/paused state; use session pooler 5432 on IPv4. |
| SSL/certificate error | Preserve the error text with credentials removed; TLS verification still needs to be completed. Do not turn verification off. |
| Missing Supabase configuration | Fill the publishable key and URL in the files listed above, then restart. |
| Supabase login returns to the wrong page | Check Site URL and the exact local callback allowlist in Authentication → URL Configuration. |
| API requests return 404 | Website `VITE_API_URL` must be `http://localhost:8080/api`. |
| Browser CORS error | Open `http://localhost:5173`, match `DASHBOARD_ORIGINS`, and restart the API. |
| Google redirect mismatch while signing in | Copy Supabase's exact `/auth/v1/callback` URL into the Google OAuth client. |
| Google redirect mismatch while connecting a calendar | Add `http://localhost:8080/api/calendar/oauth/callback` to the same Google OAuth client's authorized redirect URIs and set API `PUBLIC_API_URL=http://localhost:8080`. |
| No calendars or denied access | Check Google Calendar API, test-user membership, calendar scope, and reauthorization. |
| Microsoft says the redirect URI does not match | In Entra, add the exact Web URI `http://localhost:8080/api/microsoft/oauth/callback`; keep API `PUBLIC_API_URL=http://localhost:8080`, then restart API. |
| A work Microsoft account requires approval | Ask that Microsoft 365 tenant's administrator to review the delegated `User.Read` and `Calendars.ReadWrite` request. Do not switch to application permissions. |
| Microsoft connects but no calendar is writable | Confirm the account owns or can edit at least one Outlook calendar, reconnect it, then select that calendar as the booking destination. |
| Slack shows no channels | Invite the DeskRoute Slack app into the intended channel, return to DeskRoute, and select **Check again**. |
| Slack OAuth fails | Match the Slack redirect URL to API `PUBLIC_API_URL`, verify the API Client ID/Secret, and restart API. |
| Worker rejects model configuration | `LLM_MODEL` and `SUMMARY_LLM_MODEL` need verified IDs before startup. |

When reporting an error, send its text with credentials removed and say which command or screen produced it. For current development, finish Supabase section 2 first. Customer handover additionally requires verified Supabase Auth, calendar token renewal, US inbound calling and transfers, customer isolation, deployment/restart checks, recovery procedures, and an accurate operating-cost record. These checks are not yet complete.


## Notification center and source colors (1.0.21)

Run `pnpm db:migrate` before starting the updated API. Migration `0006_spooky_rhino` creates `notification_reads` with RLS and an appointment-update index. No new environment variables or service account are required. Restart `pnpm dev:api` and refresh the web page.

The top-bar bell opens the notification center; read status persists across devices. It refreshes when opened or manually refreshed, without background polling. See [notification behavior and tests](NOTIFICATIONS_AND_CALENDAR_SOURCES.md).

Calendar event colors identify connected Google or Microsoft accounts. Below the calendar, the source legend lists the provider, account email, and selected calendar names. If an account shows zero included calendars, turn on its calendar in Connections and save. Connecting an account alone does not enable its calendars.

For SIM/mobile-number versus SIP/phone-system setup and when to start telephone testing, follow [TELEPHONY_PLAN.md](TELEPHONY_PLAN.md).
