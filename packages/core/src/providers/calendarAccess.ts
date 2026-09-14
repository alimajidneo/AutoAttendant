import type { CalendarProvider } from "@receptionist/shared";
import { getCalendarConnection, listCalendarConnections } from "../repositories/calendar-connections.js";
import { getCalendarConnectionToken } from "./googleAuth.js";
import { tokenForMicrosoftConnection } from "./microsoftAuth.js";

export type CalendarCredential = { connectionId: string; provider: CalendarProvider; token: string };
export type CalendarAccess = {
  accounts: Array<{ connectionId: string; provider: CalendarProvider; accountEmail: string; colorIndex: number }>;
  booking: CalendarCredential & { calendarId: string };
  conflicts: Array<CalendarCredential & { calendarIds: string[] }>;
};

async function token(agentId: string, row: Awaited<ReturnType<typeof getCalendarConnection>>) {
  if (!row) return null;
  return row.provider === "google"
    ? getCalendarConnectionToken(agentId, row.id)
    : tokenForMicrosoftConnection(agentId, row);
}

export async function getCalendarCredential(agentId: string, connectionId: string, employeeId?: string): Promise<CalendarCredential | null> {
  const row = await getCalendarConnection(agentId, connectionId);
  if (employeeId && row?.employeeId !== employeeId) return null;
  const accessToken = await token(agentId, row);
  return row && accessToken ? { connectionId: row.id, provider: row.provider, token: accessToken } : null;
}

export async function getAllCalendarConnectionTokens(agentId: string) {
  const rows = await listCalendarConnections(agentId);
  return Promise.all(rows.map(async (row, colorIndex) => ({ row, colorIndex, token: await token(agentId, row) })));
}

export async function getAgentCalendarAccess(
  agentId: string,
  bookingCalendarId: string | null,
  payload: { bookingConnectionId?: string; conflictCalendars?: Array<{ connectionId?: string; id: string }> } | null,
): Promise<CalendarAccess | null> {
  const bookingConnectionId = payload?.bookingConnectionId;
  if (!bookingCalendarId || !bookingConnectionId) return null;
  const references = payload?.conflictCalendars ?? [];
  if (references.some(ref => !ref.connectionId || !ref.id)) return null;
  const selectedIds = new Set([bookingConnectionId, ...references.map(ref => ref.connectionId!)]);
  const rows = (await getAllCalendarConnectionTokens(agentId)).filter(({ row }) => selectedIds.has(row.id));
  const credentials = new Map(rows.flatMap(({ row, token }) => token
    ? [[row.id, { connectionId: row.id, provider: row.provider, token }] as const]
    : []));
  const booking = credentials.get(bookingConnectionId);
  if (!booking) return null;
  const grouped = new Map<string, Set<string>>();
  for (const ref of references) {
    const ids = grouped.get(ref.connectionId!) ?? new Set<string>();
    ids.add(ref.id);
    grouped.set(ref.connectionId!, ids);
  }
  const own = grouped.get(bookingConnectionId) ?? new Set<string>();
  own.add(bookingCalendarId);
  grouped.set(bookingConnectionId, own);
  const conflicts = [...grouped].map(([connectionId, calendarIds]) => {
    const credential = credentials.get(connectionId);
    return credential ? { ...credential, calendarIds: [...calendarIds] } : null;
  });
  if (conflicts.some(item => !item)) return null;
  return {
    accounts: rows.map(({ row, colorIndex }) => ({ connectionId: row.id, provider: row.provider, accountEmail: row.accountEmail, colorIndex })),
    booking: { ...booking, calendarId: bookingCalendarId },
    conflicts: conflicts as CalendarAccess["conflicts"],
  };
}
