# Agent context and capabilities

Updated 2026-09-10. This document separates code that exists from proposed additions. Production telephone acceptance and hosted deployment remain outstanding.

## What the current agent can do

| Capability | Current behavior and limits |
| --- | --- |
| Use business context | The call prompt includes the business description, industry, services/prices/durations, hours, timezone, caller identity when known, and approved FAQ answers. It does not browse arbitrary files or websites. |
| Answer questions | Reads the saved Knowledge FAQs in its prompt. Unknown questions can become dashboard escalations for an authorized person to answer. |
| Collect booking details | Uses configurable intake questions, caller name and callback information. A general appointment does not require a declared service. |
| Check and book | Checks selected Google calendars across connected accounts, together with business hours and booking limits. Writes bookings to the chosen calendar. |
| Find/cancel bookings | Tools can look up upcoming appointments tied to the caller number and cancel an authorized matching booking. Caller ID is not strong identity proof; sensitive workflows need additional verification before handover. Rescheduling is not a complete supported journey yet. |
| Recognize a returning caller | Can remember a supplied name against a caller record. This is not unrestricted long-term memory or permission to disclose prior calls. |
| Request human help | Creates unanswered-question records. The browser test can request a directory-based handoff, requiring recipient acceptance and microphone connection. Real telephone transfer remains pending. |
| Transcribe | During normal calls, speech is transcribed and the conversation history is saved when the call finishes. Browser test sessions skip call-history finalization. |
| Record audio | Optional for normal calls when recording is enabled and R2 storage is configured. LiveKit egress saves a mixed audio recording; starting recording can fail independently of the conversation. Browser tests skip recording. |
| Summarize | A configured summary model reads the transcript after a normal call and writes a short factual summary: caller purpose, resolution and follow-ups. Very short transcripts are skipped, and provider failures may leave no summary. |
| Analyze audio | Current summary generation analyzes transcript text, not acoustic emotion, speaker identity or an uploaded audio file. There is no general audio-upload analysis feature or automatic quality scoring. |
| Show operational results | Calls, transcripts, summaries, available recordings, appointments, questions and in-app notifications are available subject to workspace roles. |

Recording and transcription are different: turning off stored audio does not automatically disable transcript storage. Browser test bookings are real calendar writes even though those tests do not create saved call histories. Before a customer pilot, verify the intended disclosure, retention, deletion and role access for both forms of stored data.

Code references: `apps/voice/src/receptionist/prompt.ts`, `tools.ts`, `apps/voice/src/worker.ts`, `session/summary.ts`, `packages/core/src/providers/storage.ts` and `repositories/knowledge.ts`.

## Context plan: start small

### 1. Add one editable business context section

Add **Knowledge → Business context** alongside FAQs. A manager can provide company background, who the receptionist serves, demo qualification rules, booking policies, service boundaries and approved terminology. Keep instructions about allowed actions separate from reference facts.

Use a plain text editor with clear section guidance, a character/token budget, explicit Save and a preview of the content available to the agent. No document processing, vector database or automatic web crawling is needed for this first version. The existing small FAQ collection already enters the call prompt directly.

Acceptance: an owner and manager can save context for their workspace; a member or another workspace cannot read/edit it. A new test call answers questions using saved facts, and missing facts still produce the fallback. Saving content must not silently truncate older material; show the size limit before saving.

### 2. Make publishing and freshness clear

Record who last edited the context and when. Show whether changes apply to a new call, and use the existing configuration cache deliberately; do not claim an active call automatically receives edits. Provide a preview of the published context and a focused test checklist. Keep a minimal previous revision for recovery if needed, rather than building a separate content-management system.

Acceptance: saved and previewed content match what a new call receives; failed saves preserve the previous working version. Include tests for prompt-injection text in reference material: it must not override tool authorization or disclose private data.

### 3. Add small document imports only after text works

If customers need it, allow a short PDF or text document to be extracted into **draft** context. Show extracted text and its source for human review before publication. Enforce file size/type limits and workspace ownership; allow removal of both the source and published content. Documents are reference material, not trusted instructions.

Do not automatically scrape an entire website, grant drive-wide access or ingest all Slack history. Those increase complexity, stale information, permissions and costs. Add retrieval/vector search only when a measured context-size or accuracy problem justifies it.

### 4. Add targeted operational context

After Microsoft calendars and employee sharing are tested, supply only authorized busy intervals, chosen employee booking destinations and the minimum routing information needed for the current call. Private event titles and unrelated company data must stay out of the prompt. Slack/Teams approval is a call-specific action, not permission to read all communications.

### 5. Improve call review if the pilot needs it

Start with transcript-derived outcomes, explicit action items and unresolved questions. Let a person verify extracted information before it triggers external actions. Separate any later acoustic analysis, sentiment scoring or uploaded-recording analysis from the existing factual call summary. Measure accuracy and usage cost before enabling it by default.

## Operator controls to prioritize

- Context/FAQ editing and published preview.
- Model and voice selection from an approved, compatible list, with a price/usage explanation.
- Recording state, transcript/audio retention and deletion, visible to the authorized manager.
- A test checklist for facts, unknown questions, booking conflicts, intake and transfer fallback.
- No automatic sending, booking-rule changes or cross-workspace access merely because reference content asks for it.

The context editor and document import above are a plan, not implemented controls. Today use **Settings → Business** for the description, **Knowledge → Add FAQ** for approved answers and **Settings → Agent → Appointment intake** for caller questions.
