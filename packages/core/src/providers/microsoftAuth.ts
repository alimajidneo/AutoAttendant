import { randomUUID } from "node:crypto";
import { env } from "../env.js";
import {
  getCalendarConnection,
  listCalendarConnections,
  saveCalendarConnection,
  updateCalendarConnectionCredential,
  type CalendarConnectionRow,
} from "../repositories/calendar-connections.js";
import { decryptToken, encryptToken } from "./token-encryption.js";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export class MicrosoftReconnectRequired extends Error {}

export function microsoftConnectionConfigured() {
  return !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY);
}

type MicrosoftTokens = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };

async function tokenRequest(body: URLSearchParams): Promise<MicrosoftTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error?: string };
    if (["invalid_grant", "interaction_required", "consent_required"].includes(detail.error ?? "")) {
      throw new MicrosoftReconnectRequired("Reconnect Microsoft Calendar");
    }
    throw new Error("Microsoft token service unavailable");
  }
  return response.json() as Promise<MicrosoftTokens>;
}

async function microsoftAccount(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new MicrosoftReconnectRequired("Could not verify Microsoft account");
  const user = await response.json() as { id?: string; displayName?: string; mail?: string; userPrincipalName?: string };
  const email = user.mail?.trim() || user.userPrincipalName?.trim();
  if (!user.id || !email) throw new MicrosoftReconnectRequired("Microsoft account details were unavailable");
  return { id: user.id, email, name: user.displayName?.trim() || null };
}

export async function exchangeMicrosoftAuthorizationCode(code: string, redirectUri: string, verifier: string) {
  if (!microsoftConnectionConfigured()) throw new Error("Microsoft Calendar server configuration is incomplete");
  const tokens = await tokenRequest(new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID!, client_secret: env.MICROSOFT_CLIENT_SECRET!,
    code, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier,
    scope: "openid profile email offline_access User.Read Calendars.ReadWrite",
  }));
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new MicrosoftReconnectRequired("Microsoft did not return offline access. Try connecting again.");
  }
  const granted = new Set((tokens.scope ?? "").toLowerCase().split(" "));
  if (!granted.has("calendars.readwrite")) throw new MicrosoftReconnectRequired("Approve Calendar access");
  return { refreshToken: tokens.refresh_token, account: await microsoftAccount(tokens.access_token) };
}

export async function connectMicrosoftCalendarAccount(
  agentId: string,
  refreshToken: string,
  account: { id: string; email: string; name: string | null },
) {
  const id = randomUUID();
  return saveCalendarConnection({
    id, agentId, provider: "microsoft", providerAccountId: account.id,
    accountEmail: account.email, accountName: account.name, encryptionOwner: id,
    encryptedRefreshToken: encryptToken(refreshToken, id, env.TOKEN_ENCRYPTION_KEY!),
  });
}

const tokenCache = new Map<string, { token: string; expiresAt: number; credential: string }>();

export async function tokenForMicrosoftConnection(agentId: string, row: CalendarConnectionRow): Promise<string | null> {
  if (row.provider !== "microsoft" || !env.TOKEN_ENCRYPTION_KEY || !microsoftConnectionConfigured()) return null;
  const key = `${agentId}:${row.id}`;
  const credential = `${row.encryptionOwner}:${row.encryptedRefreshToken}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() && cached.credential === credential) return cached.token;
  try {
    const tokens = await tokenRequest(new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID!, client_secret: env.MICROSOFT_CLIENT_SECRET!,
      refresh_token: decryptToken(row.encryptedRefreshToken, row.encryptionOwner, env.TOKEN_ENCRYPTION_KEY),
      grant_type: "refresh_token", scope: "openid profile email offline_access User.Read Calendars.ReadWrite",
    }));
    if (!tokens.access_token) throw new Error("Microsoft token renewal returned no access token");
    let activeCredential = credential;
    if (tokens.refresh_token) {
      const encryptedRefreshToken = encryptToken(tokens.refresh_token, row.encryptionOwner, env.TOKEN_ENCRYPTION_KEY);
      const updated = await updateCalendarConnectionCredential(
        agentId,
        row.id,
        encryptedRefreshToken,
        row.encryptionOwner,
      );
      if (updated) activeCredential = `${updated.encryptionOwner}:${updated.encryptedRefreshToken}`;
    }
    tokenCache.set(key, { token: tokens.access_token, credential: activeCredential, expiresAt: Date.now() + Math.max(60, (tokens.expires_in ?? 3600) - 300) * 1000 });
    return tokens.access_token;
  } catch (error) {
    if (error instanceof MicrosoftReconnectRequired) return null;
    throw error;
  }
}

export async function getMicrosoftConnectionTokens(agentId: string, selectedIds?: ReadonlySet<string>) {
  const rows = await listCalendarConnections(agentId);
  return Promise.all(rows.map((row, colorIndex) => ({ row, colorIndex }))
    .filter(({ row }) => row.provider === "microsoft" && (!selectedIds || selectedIds.has(row.id)))
    .map(async ({ row, colorIndex }) => ({ row, colorIndex, token: await tokenForMicrosoftConnection(agentId, row) })));
}

export async function getMicrosoftConnectionToken(agentId: string, connectionId: string) {
  const row = await getCalendarConnection(agentId, connectionId);
  return row ? tokenForMicrosoftConnection(agentId, row) : null;
}
