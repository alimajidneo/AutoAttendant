export function onboardingVoiceNote(livekitEnabled: boolean): string {
  return livekitEnabled
    ? 'No phone number is purchased. Voice tests use your LiveKit credits.'
    : 'No phone number is purchased during setup.'
}

export function onboardingIntro(livekitEnabled: boolean): string {
  return livekitEnabled
    ? 'Set up your assistant, then try a conversation in your browser.'
    : 'Set up your assistant for your business.'
}
