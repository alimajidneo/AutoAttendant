# Retell production setup for DeskRoute

**Audience:** Ali and the DeskRoute operator

**Purpose:** Configure Retell as DeskRoute's telephone and conversation layer without bypassing DeskRoute's employee, calendar, booking, privacy, or duplicate-write controls.

**Last checked against Retell's official documentation:** 2026-09-14

> This guide prepares production configuration, but it does not authorize purchasing a number, enabling billing, deploying code, applying production database migrations, placing a real call, or creating a real calendar booking. Ali must approve those actions separately.

## 1. What the finished system does

```text
Caller phones the Retell number
        ↓
Retell answers and understands the request
        ↓
Retell calls DeskRoute's signed functions
        ↓
DeskRoute identifies the employee and checks approved calendar data
        ↓
┌──────────────────────────┬───────────────────────────┐
│ Employee is reachable    │ Employee is unavailable   │
│ Agentic warm transfer    │ Book appointment or save  │
│ asks employee to accept  │ a callback message        │
└──────────────────────────┴───────────────────────────┘
        ↓
Retell sends signed lifecycle and transfer webhooks
        ↓
DeskRoute stores normalized call, transfer, booking, and message results
```

### Responsibility boundary

| Component | Responsible for |
| --- | --- |
| **Retell** | Phone number, voice, speech recognition, conversation flow, knowledge retrieval, warm-transfer call leg, and signed call events |
| **DeskRoute** | Workspace and employee authorization, protected transfer numbers, availability, approved calendars/event types, booking safety, messages, normalized records, and reconciliation |
| **Cal.com/calendar provider** | Authoritative slots and the actual calendar booking where configured |
| **Ali/account owner** | Account terms, multifactor authentication, billing approval, number purchase, recording/consent policy, employee consent, and approval for real calls/bookings |

**Do not connect Retell's native Cal.com booking tool.** Retell must call DeskRoute's booking functions. Direct Retell-to-Cal.com booking would bypass DeskRoute's explicit confirmation, tenant authorization, exactly-once protection, normalized records, and reconciliation.

## 2. Production prerequisites

Do not enable the Retell agent until every required item below is complete.

- [ ] DeskRoute web/API deployment has a stable public HTTPS origin.
- [ ] The public API health check succeeds.
- [ ] Production database backup has been created.
- [ ] Migration `0012_calcom_integration.sql` is applied if Cal.com booking will be used.
- [ ] Migration `0013_retell_function_invocations.sql` is applied for durable Retell write replay.
- [ ] The workspace owner has created the required employees in **Settings → Employees**.
- [ ] Each employee has correct hours, timezone, routing state, and manual availability.
- [ ] Each transfer destination is stored in international **E.164** format, such as `+14155550123`.
- [ ] Employees have consented to receiving transferred calls.
- [ ] Calendar owners have consented to the calendar connections assigned to them.
- [ ] The approved Cal.com event type and destination calendar are configured if direct booking is required.
- [ ] Ali has approved the Retell account, privacy policy, spending limit, and production agent.

### Values the operator needs

Record these in an approved private password manager or deployment secret manager—not in Discord, source control, screenshots, or the Retell prompt.

| Name | Meaning | Secret? |
| --- | --- | --- |
| `DESKROUTE_API_ORIGIN` | Public origin, for example `https://api.example.com` | No |
| `RETELL_AGENT_ID` | Exact ID of the approved Retell main agent | No, but keep operationally private |
| `RETELL_WORKSPACE_ID` | **DeskRoute workspace UUID**, not the Retell workspace ID | No, but keep operationally private |
| `RETELL_API_KEY` | Retell key marked as the webhook key | **Yes—server only** |

The code expects these server environment variables:

```text
RETELL_API_KEY
RETELL_AGENT_ID
RETELL_WORKSPACE_ID
```

Never create a `VITE_RETELL_API_KEY`, expose the key to the browser, paste it into a knowledge base, or commit it to an `.env` file.

## 3. Create and secure the Retell workspace

1. Sign in to Retell using the approved company identity.
2. Enable multifactor authentication (MFA).
3. Add only the people who need access.
4. Give each person the smallest role required.
5. Do not add a payment method or enable automatic recharge until Ali approves the budget.
6. Open **System Settings → API Keys**.
7. Select **Add**.
8. Name the key `DeskRoute production webhook verification`.
9. Enable restricted permissions.
10. Set every API permission group to **No Access** unless a later, separately approved automation genuinely needs it. DeskRoute currently uses this key to verify Retell signatures; it does not need to administer the Retell account through the API.
11. Save the key and select **Set as Webhook Key**. Retell permits only one webhook key at a time.
12. Copy it once into the deployment secret manager as `RETELL_API_KEY`.
13. Do not paste the key anywhere else.

If the key is exposed, delete it, create a replacement, mark the replacement as the webhook key, update the server secret, redeploy, and verify signed requests again.

## 4. Create the main voice agent

A **Conversation Flow agent** is recommended because DeskRoute has distinct lookup, transfer, booking, and message paths that should not be improvised by a single large prompt.

1. In Retell, open **Agents**.
2. Select **Create agent**.
3. Choose **Conversation Flow**.
4. Name it `DeskRoute Production Receptionist`.
5. Select the approved language and voice.
6. Set the agent to speak first.
7. Use a short opening message, for example:

   > Thank you for calling [approved company name]. I'm the virtual receptionist. How may I help you today?

8. Keep the agent in draft mode. Do not attach a phone number yet.
9. Copy its agent ID into the private operator worksheet.
10. Configure `RETELL_AGENT_ID` with that exact ID on the DeskRoute server.
11. Configure `RETELL_WORKSPACE_ID` with the approved **DeskRoute** workspace UUID.
12. In DeskRoute, open the owner-only Retell settings, save that same Retell agent ID as disabled, verify **API key configured** and **operator approved**, and only then enable it.

A mismatch among the Retell agent ID, server allowlist, and DeskRoute workspace must remain disabled and fail closed.

## 5. Build the Retell knowledge base

Retell's knowledge base is for relatively stable, approved business facts. It must not decide real-time availability or perform actions.

### 5.1 Information to include

Create a Markdown document with clear headings for:

- company overview;
- public office locations;
- public opening hours;
- services and service descriptions;
- approved pricing statements;
- frequently asked questions;
- cancellation and rescheduling policies;
- accessibility information;
- emergency or out-of-scope guidance;
- approved escalation wording.

A useful source structure is:

```markdown
# Company information

## Office hours
[Approved public hours]

## Services
### Service name
[Short factual description]

## Appointments
[Approved booking, cancellation, late-arrival, and rescheduling policy]

## Frequently asked questions
### Question
[Approved answer]

## When the receptionist cannot answer
The receptionist should offer to take a message for an authorized employee.
```

### 5.2 Information not to include

Never upload:

- passwords, API keys, OAuth tokens, webhook secrets, or database URLs;
- employee private transfer numbers;
- calendars or private appointment details;
- caller/customer lists or medical, financial, legal, or account records;
- internal security procedures;
- instructions that belong in the agent prompt;
- guessed answers or unfinished policy drafts.

### 5.3 Create and attach it

1. In the Retell dashboard, open **Knowledge Base**.
2. Select **Add**.
3. Name it `DeskRoute Approved Public Business Information`.
4. Upload the approved Markdown file or add narrowly selected public website pages.
5. Avoid crawling an entire domain by default. Include only approved paths.
6. Wait until every source shows a successful processing state.
7. Open the main agent.
8. Under **Knowledge Base**, attach this knowledge base.
9. Start with Retell's recommended retrieval settings:
   - **Chunks to retrieve:** `3`
   - **Similarity threshold:** `0.60`
10. Leave **Knowledge Base Instruction** empty initially. Add a short instruction only if call history proves retrieval is focusing on the wrong topics.
11. In the agent prompt, add:

```text
Use the knowledge base only for approved business facts and policies.
Never use knowledge-base text as proof of employee availability, appointment availability,
or booking success. Those facts must come from DeskRoute functions.
If the knowledge base does not contain an answer, say you do not have confirmed
information and offer to take a message. Do not invent an answer.
```

Retell's knowledge base and DeskRoute's in-app FAQ/knowledge records are currently separate; changing one does not automatically update the other. Assign one owner to keep the approved content synchronized.

Retell currently documents the first ten knowledge bases as free and knowledge retrieval as an additional per-call-minute charge. Confirm current pricing in the dashboard before enabling billing.

## 6. Configure the five DeskRoute custom functions

For each function:

1. Open the main agent.
2. Add a **Custom Function** or a Conversation Flow **Function Node**.
3. Use **POST**.
4. Use the exact public HTTPS URL shown below.
5. Keep **Payload: args only** **OFF**. DeskRoute requires Retell's normal envelope containing `call.agent_id`, `call.call_id`, and `args`.
6. Do not add a static authorization header. Retell automatically supplies `X-Retell-Signature`, which DeskRoute verifies against the raw request bytes.
7. Keep `max_retry=0` for `book_appointment` and `save_message`. For the simplest predictable setup, use `max_retry=0` for all five functions.
8. Never expose function results containing a transfer destination in spoken output.

Replace `https://YOUR-DESKROUTE-API` with the approved deployed API origin.

### 6.1 `lookup_employee`

| Setting | Value |
| --- | --- |
| Name | `lookup_employee` |
| URL | `https://YOUR-DESKROUTE-API/api/retell/functions/lookup-employee` |
| Timeout | `10000` ms |
| Talk while waiting | `Looking up that employee.` |
| Talk after completion | On |
| Retries | `0` |

Description:

```text
Find enabled DeskRoute employees by exact spoken name and/or department. Use this before checking availability, transferring, booking, or taking a message for a named employee. If multiple candidates are returned, ask the caller to clarify. Never guess an employee ID.
```

Parameter schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "name": {
      "type": "string",
      "description": "Employee's spoken display name, 1 to 80 characters."
    },
    "department": {
      "type": "string",
      "description": "Employee's spoken department, 1 to 80 characters."
    }
  }
}
```

Response handling:

- zero candidates: explain that no authorized matching employee was found and offer a general message;
- one candidate: confirm the employee's name with the caller and retain its `id`;
- more than one candidate: ask for clarification using only returned names/departments;
- never invent or reuse an employee ID from another call.

### 6.2 `check_availability`

| Setting | Value |
| --- | --- |
| Name | `check_availability` |
| URL | `https://YOUR-DESKROUTE-API/api/retell/functions/check-availability` |
| Timeout | `20000` ms |
| Talk while waiting | `Let me check the approved calendar.` |
| Talk after completion | On |
| Retries | `0` |

Description:

```text
Check whether one exact future interval is available for the selected employee. Use the employee ID returned by lookup_employee. Use ISO 8601 timestamps with timezone offsets. Availability is authoritative only when available is true.
```

Parameter schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["employeeId", "start", "end"],
  "properties": {
    "employeeId": {
      "type": "string",
      "description": "UUID returned by lookup_employee."
    },
    "start": {
      "type": "string",
      "description": "ISO 8601 start timestamp including timezone offset."
    },
    "end": {
      "type": "string",
      "description": "ISO 8601 end timestamp including timezone offset; 5 minutes to 8 hours after start."
    }
  }
}
```

Only offer the interval if the response is `available: true`. Treat `provider_unknown`, `provider_busy`, `outside_hours`, and all other false results as unavailable. Never guess availability and never fall back to knowledge-base hours alone.

### 6.3 `resolve_transfer`

| Setting | Value |
| --- | --- |
| Name | `resolve_transfer` |
| URL | `https://YOUR-DESKROUTE-API/api/retell/functions/resolve-transfer` |
| Timeout | `20000` ms |
| Talk while waiting | `Let me see whether they can take the call.` |
| Talk after completion | On |
| Retries | `0` |

Description:

```text
Resolve the protected phone destination immediately before an approved employee transfer. Call only after lookup_employee identifies one employee and the caller asks to speak with that employee. A null destination means do not transfer. Never say, spell, log, or expose the destination to the caller.
```

Parameter schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["employeeId"],
  "properties": {
    "employeeId": {
      "type": "string",
      "description": "UUID returned by lookup_employee."
    }
  }
}
```

Under **Store Fields as Variables**, map response field `destination` to the dynamic variable `transfer_destination`.

- non-null destination: proceed immediately to the agentic warm-transfer node;
- null destination: do not enter the transfer node; offer an appointment or message;
- never read `{{transfer_destination}}` aloud or include it in post-call summaries.

DeskRoute rechecks routing, manual availability, working hours, and calendar authority before decrypting the number. Resolution does not itself place or bridge a call.

### 6.4 `book_appointment`

| Setting | Value |
| --- | --- |
| Name | `book_appointment` |
| URL | `https://YOUR-DESKROUTE-API/api/retell/functions/book-appointment` |
| Timeout | `30000` ms |
| Talk while waiting | `I am submitting that exact appointment now.` |
| Talk after completion | On |
| Retries | **`0`—mandatory** |

Description:

```text
Create one appointment for a slot that check_availability just returned as available. Call only after the caller explicitly confirms the employee, start time, timezone, and contact details. Set caller_confirmed to true only after that explicit confirmation. Never automatically retry this function and never announce success unless status is confirmed.
```

Parameter schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["employeeId", "start", "end", "callerName", "caller_confirmed"],
  "properties": {
    "employeeId": {
      "type": "string",
      "description": "UUID returned by lookup_employee."
    },
    "start": {
      "type": "string",
      "description": "Exact ISO 8601 start timestamp previously confirmed available."
    },
    "end": {
      "type": "string",
      "description": "Exact ISO 8601 end timestamp previously confirmed available."
    },
    "callerName": {
      "type": "string",
      "description": "Caller's stated name, 1 to 100 characters."
    },
    "caller_email": {
      "type": "string",
      "description": "Caller's stated valid email address, when supplied."
    },
    "caller_phone": {
      "type": "string",
      "description": "Caller's stated international E.164 phone number, when supplied."
    },
    "caller_confirmed": {
      "type": "boolean",
      "description": "True only after the caller explicitly confirms employee, time, timezone, and contact details."
    },
    "purpose": {
      "type": "string",
      "description": "Short caller-approved appointment purpose, 1 to 300 characters."
    }
  }
}
```

Required confirmation wording:

> I have [employee], [date] at [time] [timezone], using [masked or repeated contact detail]. Should I create this appointment now?

Set `caller_confirmed: true` only after an unambiguous yes. A vague response such as “maybe,” silence, or a topic change is not confirmation.

Response handling:

| Response | What Retell may say/do |
| --- | --- |
| `status: confirmed` | Announce that the appointment is confirmed. |
| `status: confirmation_required` | Read back the details and request explicit confirmation; do not claim a booking. |
| `status: contact_required` | Ask for the required email or international phone number; confirm again before booking. |
| `status: unavailable` | Apologize and offer another interval or a message. |
| `status: use_calcom` | Do not claim a booking; follow the approved link-handoff policy or offer a message. |
| `status: unknown` | Say the result could not be safely confirmed, do **not** retry, and explain that staff must verify it. |
| `reason: reconciliation_required` | Same as unknown: do not retry or create another booking. |

The words “booked,” “confirmed,” or “scheduled” must only be used after `status: confirmed`.

### 6.5 `save_message`

| Setting | Value |
| --- | --- |
| Name | `save_message` |
| URL | `https://YOUR-DESKROUTE-API/api/retell/functions/save-message` |
| Timeout | `10000` ms |
| Talk while waiting | Off or `I am saving that message.` |
| Talk after completion | On |
| Retries | **`0`—mandatory** |

Description:

```text
Save one callback message when an employee is unavailable, a warm transfer is declined/cancelled, booking cannot be safely completed, or the caller asks to leave a message. Repeat the message and contact number for caller confirmation before saving. Do not include secrets or a full transcript.
```

Parameter schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["message", "caller_confirmed"],
  "properties": {
    "message": {
      "type": "string",
      "description": "Caller-approved message, 1 to 1000 characters."
    },
    "callerName": {
      "type": "string",
      "description": "Caller's stated name, up to 100 characters."
    },
    "callerPhone": {
      "type": "string",
      "description": "Caller's stated callback number in E.164 format."
    },
    "caller_confirmed": {
      "type": "boolean",
      "description": "Set true only after reading the message and callback details back and receiving explicit caller confirmation."
    }
  }
}
```

Announce that the message was saved only when the response contains `saved: true`. If the response contains `status: confirmation_required`, read the details back, obtain explicit confirmation, and call once with `caller_confirmed: true`. Do not repeat the function after a timeout or uncertain result.

## 7. Build the main conversation flow

Use the following flow rather than allowing unrestricted tool selection.

1. **Greeting and intent**
   - Ask how the caller may be helped.
   - Determine whether the caller wants information, an employee, an appointment, or a message.
2. **Public information path**
   - Answer only from the attached approved knowledge base.
   - If the answer is absent, offer a message.
3. **Employee path**
   - Call `lookup_employee`.
   - Resolve ambiguity verbally.
   - Ask the caller to confirm the selected employee.
4. **Transfer path**
   - Call `resolve_transfer` immediately before transfer.
   - If destination is null, go to appointment/message fallback.
   - If present, enter the **Agentic Warm Transfer** node using `{{transfer_destination}}`.
5. **Booking path**
   - Collect the requested date, time, timezone, caller name, and required contact details.
   - Call `check_availability` for exact intervals.
   - Offer only intervals returned as available.
   - Read back all details and obtain explicit confirmation.
   - Call `book_appointment` once.
   - Announce success only for `status: confirmed`.
6. **Message path**
   - Collect a concise message, name, and callback number.
   - Read them back and obtain explicit caller confirmation.
   - Call `save_message` once with `caller_confirmed: true` only after that confirmation.
7. **End call**
   - Summarize only confirmed outcomes.
   - Do not summarize an uncertain booking as successful.
   - Thank the caller and use Retell's End Call node.

Add a global fallback reachable from every node:

```text
If a function fails, times out, returns an unknown result, or supplies malformed data,
do not invent a result and do not repeat a write function. Apologize briefly, explain that
the action could not be safely confirmed, and offer to save a message for staff review.
```

## 8. Configure employee-accepted agentic warm transfer

DeskRoute requires the employee to explicitly accept before the caller is joined. Therefore use **Agentic Warm Transfer**, not cold transfer and not basic human-detection-only warm transfer.

### 8.1 Create the transfer screening agent

1. In the Agentic Warm Transfer settings, open **Two-way Conversation Agent**.
2. Select **Create new**.
3. Choose **Single Prompt**.
4. Name it `DeskRoute Employee Transfer Screener`.
5. Use this prompt:

```text
You are DeskRoute's private transfer screening agent.
Your only job is to ask the person who answered whether they are the intended employee
and whether they explicitly accept the caller now.

Briefly state that DeskRoute has a caller waiting and give only the minimum caller-approved
reason needed for the handoff. Do not disclose calendar details, private contact information,
secrets, or unrelated transcript content.

Use Bridge Transfer only after the intended employee gives a clear yes that they can take
the call now.

Use Cancel Transfer when any of the following occurs:
- the person says no, not now, unavailable, or asks for a message;
- the person is not the intended employee;
- voicemail, an automated system, or an internal queue answers without reaching the employee;
- the response is unclear, silent, or times out;
- you cannot establish explicit acceptance.

Never bridge based only on human detection, a greeting, or silence. Never persuade the
employee to accept. After deciding, immediately use Bridge Transfer or Cancel Transfer.
```

6. Save and version this transfer agent.
7. Pin the main agent's transfer node to the reviewed transfer-agent version rather than silently following future edits.

### 8.2 Configure the transfer node

1. Set destination to the dynamic variable `{{transfer_destination}}`.
2. Keep E.164 formatting enabled.
3. Select **Agentic Warm Transfer**.
4. Select the `DeskRoute Employee Transfer Screener` version.
5. Set transfer ring duration to approximately 25–30 seconds unless the business has an approved alternative.
6. Set **Wait time for agent answer** to approximately 30 seconds.
7. Set **Action on timeout** to **Cancel Transfer**. Never bridge on timeout.
8. Use Retell Agent's Number as displayed caller ID initially. Caller-number override can fail depending on the telephony provider and must be separately verified.
9. Use standard ringtone/on-hold audio initially.
10. Use a short three-way message such as:

    > You are now connected. I will leave the call.

11. Connect the transfer-failed/cancelled transition back to the main agent's message/appointment fallback.
12. Never put a static employee number in the Retell flow. All destinations must come from `resolve_transfer`.

Transfer Call works only on real phone calls, not Retell web calls. A controlled phone acceptance check is mandatory before production traffic.

## 9. Paste these rules into the main-agent global prompt

```text
You are DeskRoute, a concise and courteous virtual receptionist.

HARD SAFETY RULES
1. Use DeskRoute functions for employees, availability, transfers, appointments, and messages.
2. Never use the knowledge base as proof of live availability or booking success.
3. Never invent an employee, employee ID, time slot, policy, transfer destination, or function result.
4. Never say or expose a transfer phone number.
5. Transfer only after resolve_transfer returns a destination, and use agentic warm transfer.
6. The employee must explicitly accept before the caller is bridged.
7. Offer only slots for which check_availability returned available=true.
8. Before booking, repeat employee, date, time, timezone, and contact details and ask whether to create it now.
9. Set caller_confirmed=true only after an unambiguous yes.
10. Call book_appointment only once. Never retry it after a timeout, unknown result, or reconciliation_required result.
11. Say an appointment is confirmed only when book_appointment returns status=confirmed.
12. Read a message and callback details back, obtain explicit confirmation, then call save_message once with caller_confirmed=true; announce it was saved only when saved=true.
13. If data is missing or uncertain, explain that you cannot safely confirm it and offer a message.
14. Never request passwords, payment-card data, government identifiers, medical details, or API credentials.
15. Keep spoken responses short and read dates, times, email addresses, and phone numbers back carefully.
```

## 10. Configure post-call extraction

1. Open the main agent.
2. Select **Post Call Extraction**.
3. Add a **Selector** field.
4. Name it exactly `deskroute_outcome`.
5. Use exactly these choices:
   - `answered`
   - `booked`
   - `escalated`
   - `abandoned`
   - `error`
6. Use this description:

```text
Classify the final DeskRoute outcome. Use booked only when the DeskRoute book_appointment
function returned status=confirmed. Use escalated when save_message returned saved=true.
Use answered when the request was handled or an employee transfer was bridged without a
booking/message. Use abandoned when the caller left before resolution. Use error for an
unresolved technical failure. Never infer booked from conversational wording alone.
```

DeskRoute independently marks a confirmed booking as booked and a bridged transfer as answered. A later analysis event cannot downgrade an already confirmed booked outcome.

Do not add unnecessary transcript extraction fields. DeskRoute does not need full transcripts to show normalized operational results.

## 11. Configure signed Retell webhooks

### 11.1 Register the endpoint

1. Open the approved main agent.
2. Find the agent-level webhook setting.
3. Enter:

```text
https://YOUR-DESKROUTE-API/api/retell/webhook
```

4. Subscribe only to:
   - `call_started`
   - `call_ended`
   - `call_analyzed`
   - `transfer_started`
   - `transfer_bridged`
   - `transfer_cancelled`
   - `transfer_ended`
5. Do not subscribe to transcript streaming events.
6. Use an **agent-level** webhook for isolation. Retell documents that an agent-level webhook suppresses the account-level webhook for that agent.
7. Select **Test** and confirm DeskRoute returns a successful response.
8. Confirm the server receives an `X-Retell-Signature` header and rejects unsigned or stale requests.

DeskRoute verifies the exact raw request body, enforces Retell's five-minute signature window, limits unauthenticated bodies to 262,144 actual streamed bytes, deduplicates lifecycle/transfer events, and returns `Cache-Control: no-store`.

Do not place secrets in the webhook URL or query string.

## 12. Privacy, recording, and retention

Retell's official documentation says its default may retain call logs, transcripts, recordings, caller IDs, knowledge-retrieval logs, dynamic variables, and metadata. Do not leave that default unchanged.

1. Open the main agent.
2. Open **Security & Fallback Settings → Data Storage Settings**.
3. Select **Basic Attributes Only** unless Ali approves a different written policy.
   - This prevents Retell from retaining transcripts, recordings, and logs in call history.
4. Do not enable a separate recording feature.
5. Set retention to **7 days**, the shortest currently documented option compatible with DeskRoute's approximate one-to-two-week operational preference.
6. Restrict Retell dashboard access.
7. If recordings are ever approved, first determine the law for every caller/employee location, create the required consent policy, and place the disclosure in the first non-interruptible message.
8. DeskRoute will ignore raw transcript and recording fields sent in webhooks. It stores normalized call facts, a bounded summary when supplied, masked caller numbers, transfer status, and confirmed outcomes.
9. Never store private employee transfer numbers in summaries, knowledge sources, prompts, or analysis fields.

Note: Retell documents that webhooks may still contain sensitive call data even when dashboard storage is limited. DeskRoute's receiver deliberately discards raw transcripts and recordings.

## 13. Configure the phone number

A number purchase or imported telephony connection can create cost and account obligations, so Ali must approve the option first.

For the first pilot, the approved scope is **one Retell-managed US local number and US destinations only**. Pakistan/international transfer routes and custom SIP carriers are deferred. Do not enable international calling while this scope is active.

### Option A: Retell-managed number

1. Open **Phone Numbers**.
2. Select **Purchase number**.
3. Confirm country, capabilities, recurring cost, per-minute rates, and regulatory/KYC requirements.
4. Purchase only after Ali approves the exact number and spending limit.
5. Bind `DeskRoute Production Receptionist` as the **inbound** agent.
6. Leave outbound calling disabled unless separately approved.
7. Configure an approved fallback number for concurrency exhaustion only after the destination owner consents.

### Option B: Existing number/custom telephony

Use an imported number or SIP trunk only after its provider, transfer behavior, caller ID behavior, encryption, and cost are reviewed. Do not change existing company telephony routes without a rollback plan.

For the first pilot, prefer the simplest approved Retell-managed inbound number. Leave LiveKit unconfigured and `VITE_LIVEKIT_ENABLED` unset; it is not a fallback for the Retell-only production path.

## 14. Version and release the Retell agent

1. Save the main agent as a named version, for example `DeskRoute production candidate 1`.
2. Save and pin the reviewed transfer-agent version.
3. Verify the main agent references the correct knowledge base and transfer-agent version.
4. Verify every URL uses the production HTTPS origin—not localhost, a temporary tunnel, or an old deployment.
5. Verify the five custom functions use `max_retry=0` for both write functions.
6. Run Retell's text simulation scenarios first.
7. Run a web call for voice quality and function behavior; remember that phone transfer cannot be tested in a web call.
8. After approval, bind the reviewed main-agent version to the approved phone number.
9. Do not edit the live version directly. Create a new draft/version, test it, then deliberately switch the number.

## 15. Acceptance checklist

### 15.1 Pre-telephone checks

These checks avoid number purchase and real telephone calls, but Retell text simulation or web-call usage may still be metered by the provider. Confirm the account shows zero cost/free allowance or obtain explicit spend approval before starting either. Calendar booking and message functions also create real application/provider records unless they are pointed at an isolated test environment.

- [ ] Agent answers with the approved identity and does not claim to be human.
- [ ] Knowledge-base answers match the approved source.
- [ ] Unknown knowledge questions produce an honest fallback, not an invented answer.
- [ ] Employee lookup handles zero, one, and multiple matches.
- [ ] Protected transfer numbers are never spoken or displayed to callers.
- [ ] Invalid signatures return `401`.
- [ ] Oversized bodies return `413`.
- [ ] Disabled or mismatched agent/workspace mappings do not execute functions.
- [ ] Post-call outcome choices exactly match DeskRoute's five accepted values.

### 15.2 Controlled real-phone checks—requires approval

- [ ] Employee is called through Agentic Warm Transfer.
- [ ] Caller hears hold audio while the employee is screened.
- [ ] A clear employee “yes” bridges the call.
- [ ] Employee “no,” voicemail, silence, wrong person, or timeout cancels the transfer.
- [ ] A cancelled transfer returns the caller to booking/message fallback.
- [ ] Transfer webhook states appear once in DeskRoute.
- [ ] Caller ID behavior is acceptable.
- [ ] AI/telephony charges stay within the approved limit.

### 15.3 Controlled real-booking checks—requires separate approval

- [ ] An exact provider slot is checked.
- [ ] The agent repeats employee, date, time, timezone, and contact details.
- [ ] No write happens before explicit caller confirmation.
- [ ] One confirmation creates exactly one provider booking.
- [ ] The event appears on exactly the selected destination calendar.
- [ ] The agent announces success only after `status: confirmed`.
- [ ] Repeating the same invocation does not create a second event.
- [ ] A simulated ambiguous result does not trigger a retry and is shown for reconciliation.

## 16. Troubleshooting

### Function returns `401 Unauthorized`

- Confirm Retell is using the key marked **Webhook Key**.
- Confirm the same key is configured as server-only `RETELL_API_KEY`.
- Confirm no proxy or middleware rewrites the raw request body before verification.
- Confirm server time is accurate; signatures older/newer than five minutes are rejected.
- Never disable signature verification to make the call work.

### Function returns `204 No Content`

The request may be authentic but the Retell agent is not mapped to an enabled DeskRoute workspace. Check:

- Retell `call.agent_id` equals `RETELL_AGENT_ID`;
- `RETELL_WORKSPACE_ID` is the DeskRoute workspace UUID;
- the owner-only DeskRoute Retell connection is enabled;
- the deployment has the latest environment values.

### Function returns `400 Invalid arguments`

- Keep **Payload: args only** off.
- Confirm the top-level schema type is `object`.
- Use exact field names and no additional fields.
- Use UUID employee IDs returned by `lookup_employee`.
- Use ISO 8601 timestamps with timezone offsets.
- Use E.164 phone numbers.
- Keep intervals between five minutes and eight hours.

### Transfer does not start

- Transfer Call does not work in Retell web calls; use an approved real phone test.
- Confirm `resolve_transfer` returned a non-null destination.
- Confirm destination was stored as `transfer_destination`.
- Confirm the transfer target is `{{transfer_destination}}`.
- Confirm employee routing is enabled, manual availability is Available, current time is within working hours, and a protected destination exists.

### Transfer reaches voicemail or bridges without consent

- Confirm the transfer type is **Agentic Warm Transfer**.
- Confirm timeout action is **Cancel Transfer**.
- Confirm the transfer-agent prompt requires explicit acceptance.
- Confirm the flow is pinned to the reviewed transfer-agent version.
- Basic human detection is not sufficient for DeskRoute's acceptance requirement.

### Agent claims a booking but none exists

- Confirm the prompt permits success only for `status: confirmed`.
- Confirm Retell is not using its native Cal.com integration.
- Confirm the booking custom function has `max_retry=0`.
- Treat `unknown` or `reconciliation_required` as unresolved and inspect the selected provider calendar before any release/retry.

### Knowledge answer is wrong

1. Open the call in Retell history.
2. Inspect **Knowledge Base Retrieval** for the relevant turn.
3. If the right chunk was not retrieved, improve Markdown headings/content before changing thresholds.
4. If the right chunk was retrieved but ignored, tighten the prompt.
5. Change the default `3` chunks / `0.60` threshold only with evidence.

## 17. Operating rules after launch

- Review failed functions, cancelled transfers, unknown bookings, and saved messages daily during the pilot.
- Keep write retries disabled.
- Reconcile uncertain bookings against the selected provider calendar before trying again.
- Rotate the Retell webhook key deliberately and verify the new deployment before deleting the old secret.
- Review knowledge sources whenever public policy changes.
- Audit workspace members and API keys regularly.
- Review retention, consent, and spending monthly.
- Keep a rollback path to the last known-good Retell agent version and phone binding.

## 18. Official Retell references

- [Configuration overview](https://docs.retellai.com/build/overview)
- [Conversation Flow agents](https://docs.retellai.com/build/conversation-flow/overview)
- [Custom functions](https://docs.retellai.com/build/single-multi-prompt/custom-function)
- [Transfer Call: cold, warm, and agentic warm transfer](https://docs.retellai.com/build/single-multi-prompt/transfer-call)
- [Conversation Flow call-transfer node](https://docs.retellai.com/build/conversation-flow/call-transfer-node)
- [Knowledge base setup](https://docs.retellai.com/build/knowledge-base)
- [Register webhooks](https://docs.retellai.com/features/register-webhook)
- [Secure webhooks](https://docs.retellai.com/features/secure-webhook)
- [Post Call Extraction](https://docs.retellai.com/features/post-call-analysis-create)
- [Manage API keys](https://docs.retellai.com/accounts/manage-api-keys)
- [Data storage privacy](https://docs.retellai.com/accounts/privacy-disable)
- [Data retention](https://docs.retellai.com/accounts/data-retention)
- [Receive calls](https://docs.retellai.com/deploy/inbound-call)

For implementation details and verification evidence, also read:

- [Retell MVP implementation](RETELL_MVP_IMPLEMENTATION.md)
- [Cal.com integration and reconciliation](CALCOM_INTEGRATION.md)
