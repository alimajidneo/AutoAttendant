import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { verifyRetellSignature, normalizeRetellEvent } from './retell.js';
const now = 1789380000000, key = 'test-only', raw = '{ "event": "call_ended" }';
const sign = (time = now) => `v=${time},d=${createHmac('sha256', key).update(raw + time).digest('hex')}`;
it('verifies the original bytes and both five minute boundaries', () => {
  for (const time of [now, now - 300000, now + 300000]) expect(verifyRetellSignature(raw, key, sign(time), now)).toBe(true);
  expect(verifyRetellSignature(JSON.stringify(JSON.parse(raw)), key, sign(), now)).toBe(false);
});
it('rejects malformed, expired, wrong-key and non-hex signatures without throwing', () => {
  for (const signature of ['', sign(now - 300001), sign(now + 300001), sign() + '00', sign().slice(0, -2), sign().replace(/d=.*/, 'd=' + 'z'.repeat(64)), 'prefix' + sign(), sign() + '\n', 'v=99999999999999999999999,d=' + 'a'.repeat(64)]) expect(verifyRetellSignature(raw, key, signature, now)).toBe(false);
  expect(verifyRetellSignature(raw, 'wrong', sign(), now)).toBe(false);
  expect(verifyRetellSignature(raw, '', sign(), now)).toBe(false);
});
const call = { agent_id: 'agent_a', call_id: 'call_a', start_timestamp: now, end_timestamp: now + 60000, call_status: 'ended', from_number: '+14155550123', duration_ms: 60000, call_cost: { combined_cost: 12.5 }, call_analysis: { call_summary: 'Asked for Sam' }, transcript: 'PRIVATE', recording_url: 'SECRET' };
it('normalizes only permitted fields, masks caller and uses cents without conversion', () => {
  const value = normalizeRetellEvent({ event: 'call_analyzed', call, transfer_destination: '+14155559999' })!;
  expect(value).toMatchObject({ dedupKey: JSON.stringify(['call_analyzed', 'call_a']), retellAgentId: 'agent_a', callId: 'call_a', values: { callerPhone: '•••• 0123', costCents: 12.5, durationMs: 60000, summary: 'Asked for Sam', providerStatus: 'ended' } });
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE|SECRET|1415555|transcript|recording|destination/);
});
it('ignores transcript streams and invalid shapes, and separates transfer attempts', () => {
  for (const value of [null, {}, { event: 'transcript_updated', call }, { event: 'other', call }, { event: 'call_ended', call: { ...call, agent_id: null } }, { event: 'transfer_started', call: { ...call, start_timestamp: undefined } }]) expect(normalizeRetellEvent(value)).toBeNull();
  expect(normalizeRetellEvent({ event: 'transfer_bridged', start_timestamp: now, call })!).toMatchObject({ dedupKey: JSON.stringify(['transfer_bridged', 'call_a', now]), values: { transferStatus: 'bridged' } });
  expect(normalizeRetellEvent({ event: 'call_ended', call: { ...call, start_timestamp: -1, end_timestamp: 'bad', call_status: {}, duration_ms: -1, call_cost: { combined_cost: '2' }, call_analysis: { call_summary: {} } } })!.values).toEqual({ callerPhone: '•••• 0123' });
});
it('requires documented top-level transfer identity and accepts exact custom outcomes only', () => {
  expect(normalizeRetellEvent({ event: 'transfer_started', call })).toBeNull();
  expect(normalizeRetellEvent({ event: 'transfer_bridged', start_timestamp: now + 1, call })?.values).toMatchObject({ transferAttemptStartedAt: now + 1, outcome: 'answered' });
  for (const outcome of ['answered', 'booked', 'escalated', 'abandoned', 'error']) expect(normalizeRetellEvent({ event: 'call_analyzed', call: { ...call, call_analysis: { custom_analysis_data: { deskroute_outcome: outcome } } } })?.values).toMatchObject({ outcome });
  for (const outcome of ['BOOKED', ' booked', {}, ['booked'], null]) expect(normalizeRetellEvent({ event: 'call_analyzed', call: { ...call, call_analysis: { custom_analysis_data: { deskroute_outcome: outcome } } } })?.values).not.toHaveProperty('outcome');
});
