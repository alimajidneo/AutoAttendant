export const livekitBrowserControlsEnabled = import.meta.env.VITE_LIVEKIT_ENABLED === 'true'
export const browserTransferUi = livekitBrowserControlsEnabled ? {
  editorLabel: 'Available for browser transfers',
  metricLabel: 'Available for transfers',
  statusLabel: 'Your transfer status',
} as const : null