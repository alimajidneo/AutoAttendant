import { expect, it } from 'vitest'
import { guidesForCapabilities, helpSearchHint } from './guides'

it('removes LiveKit-only browser call and handoff guidance when LiveKit is disabled', () => {
  const guides = guidesForCapabilities(false)
  const text = JSON.stringify(guides)

  expect(guides.map((guide) => guide.id)).not.toContain('testing')
  expect(guides.map((guide) => guide.id)).not.toContain('transfers')
  expect(text).not.toMatch(/browser (call|test|voice|transfer)|LiveKit|microphone|voice worker|transfer inbox|audio handoff/i)
  expect(helpSearchHint(false)).not.toContain('microphone')
})

it('keeps LiveKit browser test guidance when the capability is enabled', () => {
  const guides = guidesForCapabilities(true)

  expect(guides.map((guide) => guide.id)).toEqual(expect.arrayContaining(['testing', 'transfers']))
  expect(JSON.stringify(guides)).toContain('LiveKit')
  expect(helpSearchHint(true)).toContain('microphone')
})
