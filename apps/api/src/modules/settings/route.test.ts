import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types.js'

const mocks = vi.hoisted(() => ({
  getAgentById: vi.fn(), updateAgent: vi.fn(), listPhoneNumbers: vi.fn(), listServices: vi.fn(),
  getSlackConnection: vi.fn(), getRetellConnection: vi.fn(), livekitConfig: vi.fn(),
}))
vi.mock('@receptionist/core/repositories/agents.js', () => ({
  getAgentById: mocks.getAgentById, updateAgent: mocks.updateAgent, listPhoneNumbers: mocks.listPhoneNumbers,
}))
vi.mock('@receptionist/core/repositories/services.js', () => ({ listServices: mocks.listServices }))
vi.mock('@receptionist/core/repositories/slack-connections.js', () => ({ getSlackConnection: mocks.getSlackConnection }))
vi.mock('@receptionist/core/repositories/retell.js', () => ({ getRetellConnection: mocks.getRetellConnection }))
vi.mock('@receptionist/core/providers/storage.js', () => ({ storageConfigured: true }))
vi.mock('@receptionist/core/env.js', () => ({ livekitConfig: mocks.livekitConfig }))

import { settings } from './route.js'

const agent = {
  businessName: 'Pilot', industry: 'services', timezone: 'America/New_York', description: '', services: [],
  businessHours: {}, minNoticeMinutes: 60, maxAdvanceDays: 30, recordCalls: true,
  calendarProvider: null, calendarExternalId: null, calendarPayload: null,
  personaName: 'Agent', greeting: 'Hello', farewell: 'Bye', fallback: 'Sorry', bookingQuestions: [],
  checklistDismissed: false, hoursSeen: false,
}

function app() {
  return new Hono<AppEnv>().use('*', async (c, next) => {
    c.set('agentId', 'workspace-1'); c.set('workspaceOwner', true); c.set('workspaceRole', 'manager');
    await next()
  }).route('/settings', settings)
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getAgentById.mockResolvedValue(agent)
  mocks.listServices.mockResolvedValue([])
  mocks.listPhoneNumbers.mockResolvedValue([])
  mocks.getSlackConnection.mockResolvedValue(null)
  mocks.livekitConfig.mockReturnValue({ url: 'wss://livekit', apiKey: 'key', apiSecret: 'secret' })
})

it('reports recording unavailable when Retell is the active voice path even with R2 and LiveKit configured', async () => {
  mocks.getRetellConnection.mockResolvedValue({ retellAgentId: 'retell-agent', enabled: true })
  const response = await app().request('/settings')

  expect(response.status).toBe(200)
  expect((await response.json()).business).toMatchObject({ storageConfigured: true, recordingAvailable: false })
})

it('reports recording available for the LiveKit voice path when its egress and storage are configured', async () => {
  mocks.getRetellConnection.mockResolvedValue(null)
  const response = await app().request('/settings')

  expect((await response.json()).business.recordingAvailable).toBe(true)
})

it('rejects enabling recording when the active voice path cannot record', async () => {
  mocks.getRetellConnection.mockResolvedValue({ retellAgentId: 'retell-agent', enabled: true })
  const response = await app().request('/settings', {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ business: { recordCalls: true } }),
  })

  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: 'Recording is unavailable for the active voice provider' })
  expect(mocks.updateAgent).not.toHaveBeenCalled()
})
