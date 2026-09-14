import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { RetellCallFacts } from './RetellCallFacts'
it('labels Retell status, transfer result, duration and fractional cents only when present', () => {
  const html = renderToStaticMarkup(<RetellCallFacts call={{ provider: 'retell', providerStatus: 'ended', transferStatus: 'bridged', durationMs: 60000, costCents: 12.5 }} />)
  for (const value of ['Retell', 'ended', 'bridged', '60 s', '12.5¢']) expect(html).toContain(value)
  expect(renderToStaticMarkup(<RetellCallFacts call={{ provider: 'livekit' }} />)).toBe('')
  expect(renderToStaticMarkup(<RetellCallFacts call={{ provider: 'retell' }} />)).not.toContain('undefined')
})
