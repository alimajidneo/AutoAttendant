import { expect, it } from 'vitest'
import { onboardingIntro, onboardingVoiceNote } from './copy'

it('does not promise a browser voice test or LiveKit credits when LiveKit is disabled', () => {
  expect(onboardingVoiceNote(false)).toBe('No phone number is purchased during setup.')
  expect(onboardingIntro(false)).toBe('Set up your assistant for your business.')
})

it('keeps the LiveKit credit guidance when browser voice is enabled', () => {
  expect(onboardingVoiceNote(true)).toContain('LiveKit credits')
})
