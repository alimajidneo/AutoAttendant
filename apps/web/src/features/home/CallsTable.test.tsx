import { expect, it, vi } from 'vitest'
import type { CallListItem } from '@receptionist/shared'
vi.mock('@/hooks/useCallsQuery', () => ({ useCallsQuery: vi.fn() }))
vi.mock('@/hooks/useAgentZone', () => ({ useAgentZone: vi.fn() }))
import { callRowLabel } from './CallsTable'

const call: CallListItem = { id: 'one', callerId: null, callerName: 'Sam', callerPhone: '•••• 0123',
  provider: 'retell', providerStatus: 'ended', transferStatus: 'bridged', durationMs: 65000, costCents: 12,
  startedAt: '2026-09-13T10:00:00Z', endedAt: '2026-09-13T10:01:05Z', summary: null, outcome: null }
it('distinguishes summary-less Retell rows and retains their displayed facts', () => {
  const first = callRowLabel(call)
  const second = callRowLabel({ ...call, id: 'two', callerName: 'Alex', callerPhone: '•••• 4567',
    providerStatus: 'error', transferStatus: 'cancelled', durationMs: 10000, costCents: 0, outcome: 'escalated' })
  expect(first).not.toBe(second)
  for (const fact of ['No summary', 'Sam', '•••• 0123', 'Retell', 'ended', 'Transfer: bridged', '65 s', '12¢', 'Unknown']) expect(first).toContain(fact)
  for (const fact of ['Alex', '•••• 4567', 'error', 'Transfer: cancelled', '10 s', '0¢', 'Escalated']) expect(second).toContain(fact)
  expect(callRowLabel({ ...call, summary: 'Appointment booked', outcome: 'booked' })).toContain('Appointment booked')
  expect(callRowLabel({ ...call, providerCallId: 'private-provider-id', disconnectionReason: 'private-reason' })).not.toMatch(/private-/)
})
it('preserves legacy summary and fallback labels', () => {
  expect(callRowLabel({ ...call, provider: 'livekit', summary: 'Asked about hours' })).toBe('Asked about hours')
  expect(callRowLabel({ ...call, provider: undefined })).toBe('Call detail')
})
