import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  voice,
} from "@livekit/agents";
import { installBrowserHandoff } from "./session/browser-handoff.js";
import { RoomServiceClient } from "livekit-server-sdk";
import { env as coreEnv } from "@receptionist/core/env.js";
import { transferDirectory, requestBrowserTransfer, connectTransfer, endTransfer } from "@receptionist/core/repositories/transfers.js";
import * as silero from "@livekit/agents-plugin-silero";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import type { CallOutcome } from "@receptionist/shared";
import { db } from "@receptionist/core/db/client.js";
import { calls as callsTable } from "@receptionist/core/db/schema.js";
import { upsertCaller } from "@receptionist/core/repositories/callers.js";
import { createCall, finishCall } from "@receptionist/core/repositories/calls.js";
import { recordingEnabled, startCallRecording, stopCallRecording } from "@receptionist/core/providers/storage.js";
import { getAgentCalendarAccess } from "@receptionist/core/providers/calendarAccess.js";
import { getAgentById } from "@receptionist/core/repositories/agents.js";
import type { AgentDeps, CallState, SlotStore } from "./receptionist/deps.js";
import { buildSessionConfig, buildKeyterms } from "./session/pipeline.js";
import { resolveCallerPhone } from "./session/caller.js";
import { buildGreeting } from "./receptionist/greeting.js";
import { ReceptionistAgent } from "./receptionist/agent.js";
import { CallMetrics } from "./session/metrics.js";
import { extractTranscript } from "./session/transcript.js";
import { generateCallSummary } from "./session/summary.js";
import { resolveAgent, type ResolvedAgent } from "./session/resolve-agent.js";
import { notifySlack } from "@receptionist/core/providers/slack.js";

// A failed stopEgress leaves the egress running and billing, so it retries.
async function stopEgressWithRetry(egressId: string, maxAttempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await stopCallRecording(egressId);
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error(`[worker] stopEgress failed after ${maxAttempts} attempts — egress ${egressId} may be leaking:`, err);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    // Connect + wait for participant (SIP caller or browser test session)
    await ctx.connect();
    const roomName = ctx.room.name ?? "";
    const participant = await ctx.waitForParticipant();

    const isTestSession = participant.attributes["testSession"] === "true";

    const callerPhone = resolveCallerPhone(participant.attributes, isTestSession);
    const rawTrunk = !isTestSession ? (participant.attributes["sip.trunkPhoneNumber"] ?? "") : "";
    const trunkPhone = rawTrunk && !rawTrunk.startsWith("+") ? `+${rawTrunk}` : rawTrunk;

    // Blocks the critical path on a cache miss: the caller hears silence for one
    // DB round trip. Mitigated by the LRU below, not eliminated.
    let resolved: ResolvedAgent | null = null;

    if (isTestSession) {
      const agentId = participant.attributes["agentId"];
      if (!agentId) {
        console.error("[worker] no agentId in participant attributes for test session — dropping");
        return;
      }
      resolved = await resolveAgent({ agentId });
    } else {
      if (!trunkPhone) {
        console.error(`[worker] No trunkPhoneNumber found for SIP participant — dropping`);
        return;
      }
      resolved = await resolveAgent({ phoneNumber: trunkPhone });
    }

    if (!resolved) {
      console.error(`[worker] agent not found — dropping`);
      return;
    }
    const { agent, services, knowledge } = resolved;
    console.log(`[worker] resolved agent: ${agent.id}${isTestSession ? " (test session)" : ""}`);

    // Generate callId locally — zero DB roundtrip needed
    const callId = crypto.randomUUID();

    // `caller` starts null. Tools fire only after the caller speaks, by which
    // time upsertCaller has resolved.
    const callState: CallState = { wasBooked: false, wasEscalated: false };
    // Per call and in memory: an offer is only good while the conversation lasts.
    const slots: SlotStore = { held: new Map(), nextId: 1 };

    // Deferred so the insert stays off the path to first audio, while tools
    // still have something to await.
    let markCallRowReady: (created: boolean) => void = () => {};
    const callRowReady = isTestSession
      ? Promise.resolve(false)
      : new Promise<boolean>((resolve) => {
          markCallRowReady = resolve;
        });

    const deps: AgentDeps = {
      agent,
      browserTransfer: isTestSession ? {
        directory: () => transferDirectory(agent.id),
        request: target => requestBrowserTransfer(agent.id, roomName, participant.identity, target),
      } : undefined,
      services,
      caller: null,
      callerPhone,
      callId,
      getCalendarAccess: async () => {
        const current = await getAgentById(agent.id);
        return current
          ? getAgentCalendarAccess(current.id, current.calendarExternalId, current.calendarPayload)
          : null;
      },
      calendarExternalId: agent.calendarExternalId ?? null,
      conflictCalendarIds: agent.calendarPayload?.conflictCalendars?.map((calendar) => calendar.id)
        ?? (agent.calendarExternalId ? [agent.calendarExternalId] : []),
      knowledge,
      callRowReady,
      callState,
      slots,
    };

    // Build the pipeline. See session-config.ts for why turnDetection is
    //    left unset and why noise cancellation is SIP-only.
    const { sessionOptions, inputOptions } = buildSessionConfig({
      isTestSession,
      vad: ctx.proc.userData.vad as silero.VAD,
      keyterms: buildKeyterms(agent.businessName, services.map((s) => s.name)),
    });

    // Create and start session
    const session = new voice.AgentSession(sessionOptions);

    let handedOff = false;
    if (isTestSession) installBrowserHandoff({
      room: ctx.room,
      callerIdentity: participant.identity,
      authorize: (id, userId) => connectTransfer(agent.id, roomName, id, userId),
      removeRecipient: identity => new RoomServiceClient(coreEnv.LIVEKIT_URL, coreEnv.LIVEKIT_API_KEY, coreEnv.LIVEKIT_API_SECRET)
        .removeParticipant(roomName, identity),
      shutdownAgent: () => { handedOff = true; session.shutdown({ drain: true }); },
      callerLeft: () => endTransfer(agent.id, roomName),
    });

    await session.start({
      agent: new ReceptionistAgent(deps),
      room: ctx.room,
      inputOptions,
    });

    // Registered before the greeting, so the first turn is measured too.
    const callMetrics = new CallMetrics();
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      callMetrics.record(ev.metrics);
    });

    // A reply clears three gates before it plays: scheduled, authorised, and
    // the user silent. Each failure looks like silence, so these events name it.
    session.on(voice.AgentSessionEventTypes.SpeechCreated, (ev) => {
      console.log(
        `[speech] created call=${callId} source=${ev.source ?? "?"} ` +
          `userInitiated=${ev.userInitiated ?? "?"}`
      );
    });

    session.on(voice.AgentSessionEventTypes.AgentFalseInterruption, () => {
      console.warn(
        `[speech] FALSE INTERRUPTION call=${callId} — the agent was cut off by ` +
          `something that turned out not to be the caller. On a laptop this is ` +
          `usually the agent's own voice returning through the microphone.`
      );
    });

    session.on(voice.AgentSessionEventTypes.OverlappingSpeech, (ev) => {
      console.log(`[speech] overlap call=${callId} ${JSON.stringify(ev)}`);
    });

    let callErrorAlertSent = false;
    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      const err = ev.error;
      // InterruptionDetectionError carries no nested `error`, unlike the
      // STT/TTS/LLM variants.
      const cause = "error" in err ? err.error : err;
      console.error(
        `[worker] PIPELINE ERROR call=${callId} agent=${agent.id} ` +
          `type=${err.type} source=${ev.source?.label ?? "unknown"} ` +
          `recoverable=${err.recoverable}:`,
        cause instanceof Error ? cause.message : cause
      );
      if (!callErrorAlertSent) {
        callErrorAlertSent = true;
        void notifySlack(agent.id, "call-error").catch(slackError => console.error("[slack] call error alert failed:", slackError));
      }
    });

    // Register close handler BEFORE any async work — prevents race conditions
    let egressId: string | null = null;
    // Set only once egress starts, so the dashboard never presigns a URL for an
    // object nobody uploaded.
    let callRecordingKey: string | null = null;

    session.on(voice.AgentSessionEventTypes.Close, async (ev: voice.CloseEvent) => {
      try {
        if (egressId) {
          // Awaited: this handler may be the last thing running before the
          // process exits, and a dropped promise leaves the egress billing.
          await stopEgressWithRetry(egressId);
        }

        callMetrics.logSummary(callId, agent.id);

        // Test sessions skip DB finalization — no call row was created
        if (isTestSession) {
          console.log(`[worker] test session ${callId} ended`);
          if (handedOff) ctx.shutdown("Browser handoff completed");
          return;
        }

        const transcript = extractTranscript(session.history);
        const isAbandoned =
          ev.reason === voice.CloseReason.PARTICIPANT_DISCONNECTED && transcript.length <= 1;

        const summary = await generateCallSummary(transcript);

        let outcome: CallOutcome;
        if (ev.reason === voice.CloseReason.ERROR) outcome = "error";
        else if (isAbandoned) outcome = "abandoned";
        else if (callState.wasBooked) outcome = "booked";
        else if (callState.wasEscalated) outcome = "escalated";
        else outcome = "answered";

        await finishCall(callId, {
          outcome,
          transcript,
          summary,
          recordingKey: callRecordingKey,
        });

        console.log(`[worker] call ${callId} finalized: ${outcome}`);
      } catch (err) {
        console.error("[worker] CRITICAL: close handler failed — call not finalized:", callId, err);
        // A null outcome and ended_at is indistinguishable from a call still
        // running, so the row is marked even when finalisation failed.
        if (!isTestSession) {
          await finishCall(callId, {
            outcome: "error",
            transcript: [],
            summary: null,
            recordingKey: callRecordingKey,
          }).catch((writeErr: unknown) =>
            console.error("[worker] could not mark call as errored:", callId, writeErr)
          );
        }
      }
    });

    // The disclosure leads on test sessions too, so the owner hears what callers
    // hear. `recording` is false without storage, so the wording stays true.
    const recording = recordingEnabled(agent);
    const greeting = buildGreeting(agent.greeting, recording);
    session.say(greeting.text, {
      allowInterruptions: false,
    });

    // Recording + DB writes — skipped for test sessions
    if (!isTestSession) {
      // With recording off, egressId and callRecordingKey stay null and
      // finishCall writes no recording_url, which the dashboard reads as no audio.
      if (recording) {
        startCallRecording(roomName, callId)
          .then((result) => {
            egressId = result.egressId;
            callRecordingKey = result.recordingKey;
            console.log(`[worker] egress started: ${egressId}`);
          })
          .catch((err: unknown) => {
            // callRecordingKey stays null, so finishCall writes no recording_url.
            console.error("[worker] failed to start recording:", err);
          });
      } else {
        console.log(`[worker] recording off for agent ${agent.id}`);
      }

      // upsertCaller + createCall run concurrently WHILE greeting plays
      let caller: Awaited<ReturnType<typeof upsertCaller>> = null;
      try {
        [caller] = await Promise.all([
          upsertCaller(agent.id, callerPhone),
          createCall({
            id: callId,
            agentId: agent.id,
            callerId: null,
            callerPhone,
            roomName: roomName,
            disclosureVersion: greeting.version,
          }),
        ]);
        markCallRowReady(true);
      } catch (err) {
        // Unblock anything awaiting the row rather than leaving tools hanging
        // for the rest of the call. They fall back to an unlinked escalation.
        markCallRowReady(false);
        console.error("[worker] call row creation failed:", callId, err);
        throw err;
      }

      deps.caller = caller;
      // No client row for an anonymous caller, so nothing to backfill.
      if (caller) {
        db.update(callsTable)
          .set({ callerId: caller.id })
          .where(eq(callsTable.id, callId))
          .catch((err: unknown) => console.error("[worker] callerId backfill failed:", err));
      }
    }

    // Control returns to LiveKit framework — participant speaks, tools fire
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: "receptionist",
  })
);
