import type {
  CallOutcome,
  EscalationStatus,
  AppointmentStatus,
} from '@receptionist/shared'

/** Four roles, two of them coloured: `waiting` takes the accent and `failed`
 *  takes red, which is used for nothing else. */
export type StatusTone = 'fact' | 'success' | 'waiting' | 'quiet' | 'failed'

const toneClasses: Record<StatusTone, string> = {
  fact: 'bg-sunk-1 text-foreground font-medium',
  success: 'bg-success-subtle text-success font-medium',
  waiting: 'bg-primary-subtle text-accent-ink font-medium',
  quiet: 'bg-sunk-1 text-muted-foreground',
  failed: 'bg-destructive-subtle text-destructive font-medium',
}

export function toneToClasses(tone: StatusTone): string {
  return toneClasses[tone]
}

export type StatusEntry = { label: string; tone: StatusTone }

export const callOutcomeConfig: Record<CallOutcome, StatusEntry> = {
  booked:    { label: 'Booked',    tone: 'success' },
  escalated: { label: 'Escalated', tone: 'waiting' },
  answered:  { label: 'Answered',  tone: 'quiet' },
  abandoned: { label: 'Abandoned', tone: 'quiet' },
  error:     { label: 'Error',     tone: 'failed' },
}

export const appointmentStatusConfig: Record<AppointmentStatus, StatusEntry> = {
  confirmed: { label: 'Confirmed', tone: 'success' },
  requested: { label: 'Requested', tone: 'waiting' },
  cancelled: { label: 'Cancelled', tone: 'quiet' },
}

export const escalationStatusConfig: Record<EscalationStatus, StatusEntry> = {
  pending:  { label: 'Pending',  tone: 'waiting' },
  resolved: { label: 'Resolved', tone: 'success' },
}
