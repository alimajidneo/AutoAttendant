import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { CallOutcome } from './CallOutcome'
it('renders honest unknown Retell outcomes and preserves known outcomes', () => {
  expect(renderToStaticMarkup(<CallOutcome provider="retell" outcome={null} />)).toContain('Unknown')
  for (const outcome of ['answered', 'booked', 'escalated', 'abandoned', 'error'] as const) expect(renderToStaticMarkup(<CallOutcome provider="retell" outcome={outcome} />)).not.toBe('')
})
