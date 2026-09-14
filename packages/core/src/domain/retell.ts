import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyRetellSignature(rawBody: string, apiKey: string, signature: string, now: number): boolean {
  const match = /^v=(\d+),d=([a-fA-F0-9]{64})$/.exec(signature);
  if (!apiKey || !match || match[0] !== signature) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || !Number.isFinite(now) || Math.abs(now - timestamp) > 300000) return false;
  const expected = createHmac('sha256', apiKey).update(rawBody + match[1]).digest();
  const actual = Buffer.from(match[2]!, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const events = new Set(['call_started', 'call_ended', 'call_analyzed', 'transfer_started', 'transfer_bridged', 'transfer_cancelled', 'transfer_ended']);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const number = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const timestamp = (value: unknown): value is number => number(value, 8640000000000000) && Number.isSafeInteger(value);
export type RetellValues = { startedAt?: Date; endedAt?: Date; callerPhone?: string; providerStatus?: string;
  disconnectionReason?: string; transferStatus?: string; durationMs?: number; costCents?: number; summary?: string; transferAttemptStartedAt?: number; outcome?: "answered" | "booked" | "escalated" | "abandoned" | "error" };
export function normalizeRetellEvent(payload: unknown) {
  const body = object(payload), call = object(body.call);
  if (typeof body.event !== 'string' || !events.has(body.event) || !identifier(call.agent_id) || !identifier(call.call_id)) return null;
  const transfer = body.event.startsWith('transfer_');
  const attempt = body.start_timestamp;
  if (transfer && !timestamp(attempt)) return null;
  const values: RetellValues = {};
  if (timestamp(call.start_timestamp)) values.startedAt = new Date(call.start_timestamp);
  if (timestamp(call.end_timestamp) && (!values.startedAt || call.end_timestamp >= values.startedAt.getTime())) values.endedAt = new Date(call.end_timestamp);
  if (typeof call.from_number === 'string' && /^\+[1-9]\d{7,14}$/.test(call.from_number)) values.callerPhone = `•••• ${call.from_number.slice(-4)}`;
  if (['registered', 'not_connected', 'ongoing', 'ended', 'error'].includes(call.call_status as string)) values.providerStatus = call.call_status as string;
  if (identifier(call.disconnection_reason)) values.disconnectionReason = call.disconnection_reason;
  if (number(call.duration_ms, 2147483647) && Number.isInteger(call.duration_ms)) values.durationMs = call.duration_ms;
  const cost = object(call.call_cost).combined_cost;
  if (number(cost, 100000000)) values.costCents = cost;
  const summary = object(call.call_analysis).call_summary;
  if (typeof summary === 'string' && summary.trim()) values.summary = summary.trim().slice(0, 2000);
  const outcome = object(object(call.call_analysis).custom_analysis_data).deskroute_outcome;
  if (typeof outcome === 'string' && ['answered', 'booked', 'escalated', 'abandoned', 'error'].includes(outcome)) values.outcome = outcome as RetellValues['outcome'];
  if (transfer) {
    values.transferStatus = body.event.slice('transfer_'.length);
    values.transferAttemptStartedAt = attempt as number;
    if (body.event === 'transfer_bridged') values.outcome = 'answered';
  }
  return { event: body.event, callId: call.call_id, retellAgentId: call.agent_id,
    dedupKey: JSON.stringify(transfer ? [body.event, call.call_id, attempt] : [body.event, call.call_id]), values };
}
