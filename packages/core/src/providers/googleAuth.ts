import { env } from "../env.js";
import {
  getCalendarConnection,
  listCalendarConnections,
  saveCalendarConnection,
  type CalendarConnectionRow,
} from "../repositories/calendar-connections.js";
import { encryptToken, decryptToken } from "./token-encryption.js";
import { randomUUID } from "node:crypto";

export class GoogleReconnectRequired extends Error {}
export function googleConnectionConfigured(): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY);
}
async function refresh(refreshToken: string): Promise<string> {
  if (!googleConnectionConfigured()) throw new Error("Google Calendar server configuration is incomplete");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!response.ok) {
    const body = await response.json() as { error?: string };
    if (body.error === "invalid_grant") throw new GoogleReconnectRequired("Reconnect Google Calendar");
    throw new Error("Google token renewal unavailable");
  }
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Google token renewal returned no access token");
  return data.access_token;
}

const tokenCache = new Map<string, { token: string; expiresAt: number; credential: string }>();

export type GoogleAccount = { sub: string; email: string; name: string | null };

async function verifyGoogleGrant(accessToken: string, grantedScope?: string): Promise<GoogleAccount> {
  const scopes = new Set(grantedScope?.split(" "));
  if (
    !["calendar.events", "calendar.calendarlist.readonly", "calendar.freebusy"]
      .every(scope => scopes.has(`https://www.googleapis.com/auth/${scope}`))
  ) throw new GoogleReconnectRequired("Approve all requested Calendar permissions");
  const userResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000),
  });
  if (!userResponse.ok) throw new GoogleReconnectRequired("Could not verify Google account");
  const identity = await userResponse.json() as { sub?: string; email?: string; name?: string };
  if (!identity.sub || !identity.email) throw new GoogleReconnectRequired("Google account details were unavailable");
  return { sub: identity.sub, email: identity.email, name: identity.name?.trim() || null };
}

export async function exchangeGoogleAuthorizationCode(code: string, redirectUri: string, verifier: string) {
  if (!googleConnectionConfigured()) throw new Error("Google Calendar server configuration is incomplete");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!,
      code, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new GoogleReconnectRequired("Google authorization could not be completed");
  const tokens = await response.json() as { access_token?: string; refresh_token?: string; scope?: string };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new GoogleReconnectRequired("Google did not return offline access. Try connecting again.");
  }
  return { refreshToken: tokens.refresh_token, account: await verifyGoogleGrant(tokens.access_token, tokens.scope) };
}

export async function connectGoogleCalendarAccount(
  agentId: string,
  refreshToken: string,
  account: GoogleAccount,
) {
  const id = randomUUID();
  const owner = id;
  return saveCalendarConnection({
    id, agentId, providerAccountId: account.sub, accountEmail: account.email,
    accountName: account.name, encryptionOwner: owner,
    encryptedRefreshToken: encryptToken(refreshToken, owner, env.TOKEN_ENCRYPTION_KEY!),
  });
}

export async function getCalendarConnectionToken(agentId: string, connectionId: string): Promise<string | null> {
  const row = await getCalendarConnection(agentId, connectionId);
  if (!row || !env.TOKEN_ENCRYPTION_KEY) return null;
  return tokenForConnection(agentId, row);
}

async function tokenForConnection(agentId: string, row: CalendarConnectionRow): Promise<string | null> {
  if (!env.TOKEN_ENCRYPTION_KEY) return null;
  const key = `${agentId}:${row.id}`;
  const credential = `${row.encryptionOwner}:${row.encryptedRefreshToken}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() && cached.credential === credential) return cached.token;
  tokenCache.delete(key);
  try {
    const token = await refresh(decryptToken(row.encryptedRefreshToken, row.encryptionOwner, env.TOKEN_ENCRYPTION_KEY));
    for (const [cacheKey, entry] of tokenCache) {
      if (entry.expiresAt <= Date.now()) tokenCache.delete(cacheKey);
    }
    tokenCache.set(key, { token, credential, expiresAt: Date.now() + 50 * 60_000 });
    return token;
  } catch (error) {
    if (error instanceof GoogleReconnectRequired) return null;
    throw error;
  }
}

export async function getCalendarConnectionTokens(agentId: string, selectedIds?: ReadonlySet<string>) {
  const rows = await listCalendarConnections(agentId);
  return Promise.all(rows.map((row, colorIndex) => ({ row, colorIndex }))
    .filter(({ row }) => !selectedIds || selectedIds.has(row.id))
    .map(async ({ row, colorIndex }) => ({ row, colorIndex, token: await tokenForConnection(agentId, row) })));
}

export type CalendarAccess = {
  accounts: Array<{ connectionId: string; accountEmail: string; colorIndex: number }>;
  booking: { connectionId: string; calendarId: string; token: string };
  conflicts: Array<{ connectionId: string; calendarIds: string[]; token: string }>;
};

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
  const rows = await getCalendarConnectionTokens(agentId, selectedIds);
  const tokens = new Map(rows.flatMap(({ row, token }) => token ? [[row.id, token] as const] : []));
  const bookingToken = tokens.get(bookingConnectionId);
  if (!bookingToken) return null;
  const grouped = new Map<string, Set<string>>();
  for (const ref of payload?.conflictCalendars ?? []) {
    if (!ref.connectionId) continue;
    const ids = grouped.get(ref.connectionId) ?? new Set<string>();
    ids.add(ref.id);
    grouped.set(ref.connectionId, ids);
  }
  const own = grouped.get(bookingConnectionId) ?? new Set<string>();
  own.add(bookingCalendarId);
  grouped.set(bookingConnectionId, own);
  const conflicts = [...grouped].map(([connectionId, calendarIds]) => {
    const token = tokens.get(connectionId);
    return token ? { connectionId, calendarIds: [...calendarIds], token } : null;
  });
  if (conflicts.some(item => !item)) return null;
  return {
    accounts: rows.map(({ row, colorIndex }) => ({ connectionId: row.id, accountEmail: row.accountEmail, colorIndex })),
    booking: { connectionId: bookingConnectionId, calendarId: bookingCalendarId, token: bookingToken },
    conflicts: conflicts as CalendarAccess["conflicts"],
  };
}
