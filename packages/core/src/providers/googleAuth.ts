import { env } from "../env.js";
import { getGoogleCredentials, saveGoogleCredentials, deleteGoogleCredentials } from "../repositories/google-credentials.js";
import { encryptToken, decryptToken } from "./token-encryption.js";

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
export async function connectGoogleCredentials(authUserId: string, expectedSubject: string, refreshToken: string): Promise<void> {
  const accessToken = await refresh(refreshToken);
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new GoogleReconnectRequired("Could not verify Google account");
  const identity = await response.json() as { sub?: string };
  if (identity.sub !== expectedSubject) throw new GoogleReconnectRequired("Connect the Google account used to sign in");
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(10000) });
  if (!info.ok) throw new GoogleReconnectRequired("Could not verify Calendar permissions");
  const grant = await info.json() as { scope?: string; aud?: string };
  const scopes = new Set(grant.scope?.split(" "));
  if (grant.aud !== env.GOOGLE_CLIENT_ID || !["calendar.events", "calendar.calendarlist.readonly", "calendar.freebusy"].every(scope => scopes.has(`https://www.googleapis.com/auth/${scope}`))) {
    throw new GoogleReconnectRequired("Approve all requested Calendar permissions");
  }
  await saveGoogleCredentials(authUserId, expectedSubject, encryptToken(refreshToken, authUserId, env.TOKEN_ENCRYPTION_KEY!));
}
export async function getGoogleOAuthToken(authUserId: string): Promise<string | null> {
  const row = await getGoogleCredentials(authUserId);
  if (!row) return null;
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("Calendar credential encryption is not configured");
  try {
    return await refresh(decryptToken(row.encryptedRefreshToken, authUserId, env.TOKEN_ENCRYPTION_KEY));
  } catch (error) {
    if (error instanceof GoogleReconnectRequired) return null;
    throw error;
  }
}
export const forgetGoogleOAuthToken = deleteGoogleCredentials;
