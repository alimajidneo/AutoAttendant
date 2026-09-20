import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env as coreEnv } from "@receptionist/core/env.js";

export const OAUTH_COOKIE = "deskroute_calendar_oauth";
export const OAUTH_COOKIE_PATH = "/api/calendar/oauth";
export const MICROSOFT_OAUTH_COOKIE = "deskroute_microsoft_oauth";
export const MICROSOFT_OAUTH_COOKIE_PATH = "/api/microsoft/oauth";
export const SLACK_OAUTH_COOKIE = "deskroute_slack_oauth";
export const SLACK_OAUTH_COOKIE_PATH = "/api/slack/oauth";
type OAuthState = { agentId: string; expiresAt: number; challenge: string; employeeId?: string; userId?: string };
type EmployeeOAuthSubject = { employeeId: string; userId: string };

export function oauthChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createOAuthState(agentId: string, verifier: string, subject?: EmployeeOAuthSubject): string {
  if (!coreEnv.TOKEN_ENCRYPTION_KEY) throw new Error("OAuth credential encryption is not configured");
  const payload = Buffer.from(JSON.stringify({ agentId, expiresAt: Date.now() + 10 * 60_000, challenge: oauthChallenge(verifier), ...subject })).toString("base64url");
  const signature = createHmac("sha256", coreEnv.TOKEN_ENCRYPTION_KEY).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readOAuthState(value: string, verifier: string): OAuthState | null {
  if (!coreEnv.TOKEN_ENCRYPTION_KEY || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) return null;
  if (value.split(".").length !== 2) return null;
  const [payload, supplied] = value.split(".");
  if (!payload || !supplied || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return null;
  const expected = createHmac("sha256", coreEnv.TOKEN_ENCRYPTION_KEY).update(payload).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.toString("base64url") !== supplied
    || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as OAuthState;
    const subjectValid = parsed.employeeId === undefined && parsed.userId === undefined
      || typeof parsed.employeeId === "string" && parsed.employeeId.length > 0 && typeof parsed.userId === "string" && parsed.userId.length > 0;
    return typeof parsed.agentId === "string" && parsed.agentId.length > 0
      && Number.isFinite(parsed.expiresAt) && parsed.expiresAt > Date.now()
      && parsed.challenge === oauthChallenge(verifier) && subjectValid ? parsed : null;
  } catch { return null; }
}
