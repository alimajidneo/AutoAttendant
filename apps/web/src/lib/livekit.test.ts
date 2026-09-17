import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('hides LiveKit-only controls by default', async () => {
  vi.stubEnv('VITE_LIVEKIT_ENABLED', '')
  const { browserTransferUi, livekitBrowserControlsEnabled } = await import('./livekit')
  expect(livekitBrowserControlsEnabled).toBe(false)
  expect(browserTransferUi).toBeNull()
})

it('shows LiveKit-only controls only when explicitly enabled', async () => {
  vi.stubEnv('VITE_LIVEKIT_ENABLED', 'true')
  const { browserTransferUi, livekitBrowserControlsEnabled } = await import('./livekit')
  expect(livekitBrowserControlsEnabled).toBe(true)
  expect(browserTransferUi).toEqual({
    editorLabel: 'Available for browser transfers',
    metricLabel: 'Available for transfers',
    statusLabel: 'Your transfer status',
  })
})
