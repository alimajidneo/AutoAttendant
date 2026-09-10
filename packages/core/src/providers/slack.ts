import type { SlackAlertKind, SlackChannelOption } from "@receptionist/shared";
import { env } from "../env.js";
import { getSlackConnection, saveSlackConnection } from "../repositories/slack-connections.js";
import { decryptToken, encryptToken } from "./token-encryption.js";

const API = "https://slack.com/api";

type SlackEnvelope<T> = T & { ok: boolean; error?: string };

async function slackRequest<T>(method: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/${method}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json() as SlackEnvelope<T>;
  if (!response.ok || !payload.ok) throw new Error(`Slack ${method} failed: ${payload.error ?? response.status}`);
  return payload;
}

export function slackConnectionConfigured() {
  return !!(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY);
}

export async function exchangeSlackAuthorizationCode(code: string, redirectUri: string) {
  if (!slackConnectionConfigured()) throw new Error("Slack server configuration is incomplete");
  const response = await fetch(`${API}/oauth.v2.access`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID!,
      client_secret: env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json() as SlackEnvelope<{
    access_token?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
  }>;
  if (!response.ok || !payload.ok || !payload.access_token || !payload.team?.id || !payload.team.name) {
    throw new Error(`Slack OAuth failed: ${payload.error ?? response.status}`);
  }
  return {
    botToken: payload.access_token,
    botUserId: payload.bot_user_id ?? null,
    teamId: payload.team.id,
    teamName: payload.team.name,
  };
}

export async function connectSlackWorkspace(
  agentId: string,
  input: Awaited<ReturnType<typeof exchangeSlackAuthorizationCode>>,
) {
  return saveSlackConnection({
    agentId,
    teamId: input.teamId,
    teamName: input.teamName,
    botUserId: input.botUserId,
    encryptionOwner: agentId,
    encryptedBotToken: encryptToken(input.botToken, agentId, env.TOKEN_ENCRYPTION_KEY!),
  });
}

export async function getSlackBotToken(agentId: string): Promise<string | null> {
  const row = await getSlackConnection(agentId);
  if (!row || !env.TOKEN_ENCRYPTION_KEY) return null;
  return decryptToken(row.encryptedBotToken, row.encryptionOwner, env.TOKEN_ENCRYPTION_KEY);
}

export async function listSlackChannels(token: string): Promise<SlackChannelOption[]> {
  const channels: SlackChannelOption[] = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    const payload = await slackRequest<{
      channels?: Array<{ id?: string; name?: string; is_member?: boolean; is_private?: boolean }>;
      response_metadata?: { next_cursor?: string };
    }>(`conversations.list?${query}`, token);
    for (const item of payload.channels ?? []) {
      if (item.id && item.name && item.is_member) {
        channels.push({ id: item.id, name: item.name, private: !!item.is_private });
      }
    }
    cursor = payload.response_metadata?.next_cursor?.trim() ?? "";
  } while (cursor);
  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

export async function postSlackMessage(token: string, channelId: string, message: string) {
  await slackRequest("chat.postMessage", token, {
    method: "POST",
    body: JSON.stringify({ channel: channelId, text: message, unfurl_links: false, unfurl_media: false }),
  });
}

export async function revokeSlackToken(token: string) {
  await slackRequest("auth.revoke", token, { method: "POST" });
}

const alertText: Record<SlackAlertKind, string> = {
  booking: "DeskRoute booked a new appointment.",
  cancellation: "A DeskRoute appointment was cancelled.",
  request: "A DeskRoute appointment request needs review.",
  question: "DeskRoute recorded a caller question that needs an answer.",
  "call-error": "A DeskRoute call needs attention.",
};

/** Best effort only. Caller details and transcript content stay out of Slack. */
export async function notifySlack(agentId: string, kind: SlackAlertKind) {
  const row = await getSlackConnection(agentId);
  if (!row?.channelId || !row.alertKinds.includes(kind) || !env.TOKEN_ENCRYPTION_KEY) return false;
  const token = decryptToken(row.encryptedBotToken, row.encryptionOwner, env.TOKEN_ENCRYPTION_KEY);
  await postSlackMessage(token, row.channelId, alertText[kind]);
  return true;
}
