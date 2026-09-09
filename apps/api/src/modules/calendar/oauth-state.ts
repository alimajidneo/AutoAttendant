import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env as coreEnv } from "@receptionist/core/env.js";

export const OAUTH_COOKIE = "deskroute_calendar_oauth";
export const OAUTH_COOKIE_PATH = "/api/calendar/oauth";
type OAuthState = { agentId: string; expiresAt: number; challenge: string };

export function oauthChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createOAuthState(agentId: string, verifier: string): string {
  if (!coreEnv.TOKEN_ENCRYPTION_KEY) throw new Error("Calendar credential encryption is not configured");
  const payload = Buffer.from(JSON.stringify({ agentId, expiresAt: Date.now() + 10 * 60_000, challenge: oauthChallenge(verifier) })).toString("base64url");
  const signature = createHmac("sha256", coreEnv.TOKEN_ENCRYPTION_KEY).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readOAuthState(value: string, verifier: string): OAuthState | null {
  if (!coreEnv.TOKEN_ENCRYPTION_KEY || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) return null;
  if (value.split(".").length !== 2) return null;
  const [payload, supplied] = value.split(".");
  if (!payload || !supplied) return null;
  const expected = createHmac("sha256", coreEnv.TOKEN_ENCRYPTION_KEY).update(payload).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as OAuthState;
    return typeof parsed.agentId === "string" && parsed.agentId.length > 0
      && Number.isFinite(parsed.expiresAt) && parsed.expiresAt > Date.now()
      && parsed.challenge === oauthChallenge(verifier) ? parsed : null;
  } catch { return null; }
}
