import { expect, it, vi } from 'vitest'
import { preloadRoute } from './route-preload'

it('preloads only the chunk for the destination route', async () => {
  const home = vi.fn(async () => ({}))
  const appointments = vi.fn(async () => ({}))
  const settings = vi.fn(async () => ({}))
  await preloadRoute('/appointments', { '/': home, '/appointments': appointments, '/settings': settings })
  expect(appointments).toHaveBeenCalledOnce()
  expect(home).not.toHaveBeenCalled()
  expect(settings).not.toHaveBeenCalled()
})

it('uses the parent chunk for detail routes and ignores unknown routes', async () => {
  const calls = vi.fn(async () => ({}))
  await preloadRoute('/calls/example', { '/calls': calls })
  await preloadRoute('/unknown', { '/calls': calls })
  expect(calls).toHaveBeenCalledOnce()
})
