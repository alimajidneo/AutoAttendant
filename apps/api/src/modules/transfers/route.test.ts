import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), listWorkspaces: vi.fn(), workspaceAccess: vi.fn(),
  transferInbox: vi.fn(), respondToTransfer: vi.fn(), listParticipants: vi.fn() }));
vi.mock("@receptionist/core/providers/supabase.js", () => ({ supabase: { auth: { getUser: mocks.getUser } } }));
vi.mock("@receptionist/core/repositories/workspaces.js", () => mocks);
vi.mock("@receptionist/core/repositories/transfers.js", () => mocks);
vi.mock("livekit-server-sdk", async importOriginal => {
  const actual = await importOriginal<typeof import("livekit-server-sdk")>();
  return { ...actual, RoomServiceClient: class { listParticipants = mocks.listParticipants } };
});
import { transfers } from "./route.js";
import { env } from "@receptionist/core/env.js";
const id = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const headers = { Authorization: "Bearer verified", "Content-Type": "application/json", "X-Workspace-Id": id };
const respond = (accept: boolean) => transfers.request(`/${requestId}/respond`, { method: "POST", headers, body: JSON.stringify({ accept }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "member" } }, error: null });
  mocks.workspaceAccess.mockResolvedValue({ role: "member", ownerUserId: "owner" });
  mocks.respondToTransfer.mockResolvedValue({ id: requestId, roomName: "test-room", callerIdentity: "caller" });
  mocks.listParticipants.mockResolvedValue([{ identity: "caller" }]);
});
describe("browser transfer tokens", () => {
  it("scopes a token to the accepted room and disables mutable attributes", async () => {
    const response = await respond(true);
    expect(response.status).toBe(200);
    expect(mocks.respondToTransfer).toHaveBeenCalledWith(id, "member", requestId, true);
    const body = await response.json();
    const claims = JSON.parse(Buffer.from(body.token.split(".")[1], "base64url").toString());
    expect(claims.sub).toBe(`transfer-${requestId}`);
    expect(claims.video).toMatchObject({ room: "test-room", roomJoin: true, canUpdateOwnMetadata: false, canPublishData: false });
    expect(claims.video.roomAdmin).not.toBe(true);
    expect(claims.attributes).toEqual({ transferRequestId: requestId, transferUserId: "member" });
    expect(claims.exp - claims.nbf).toBeLessThanOrEqual(90);
  });
  it("does not issue a token after the caller leaves", async () => {
    mocks.listParticipants.mockResolvedValue([]);
    const response = await respond(true);
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("token");
  });
  it("does not reach LiveKit for an expired or declined request", async () => {
    mocks.respondToTransfer.mockResolvedValue(null);
    expect((await respond(true)).status).toBe(409);
    expect(mocks.listParticipants).not.toHaveBeenCalled();
    mocks.respondToTransfer.mockResolvedValue({ id: requestId });
    expect((await respond(false)).status).toBe(200);
    expect(mocks.listParticipants).not.toHaveBeenCalled();
  });
  it("rejects a removed member before loading a request", async () => {
    mocks.workspaceAccess.mockResolvedValue(null);
    expect((await respond(true)).status).toBe(403);
    expect(mocks.respondToTransfer).not.toHaveBeenCalled();
  });
  it("returns 503 without consuming an accepted request when LiveKit is unavailable", async () => {
    const original = { LIVEKIT_URL: env.LIVEKIT_URL, LIVEKIT_API_KEY: env.LIVEKIT_API_KEY, LIVEKIT_API_SECRET: env.LIVEKIT_API_SECRET };
    Object.assign(env, { LIVEKIT_URL: undefined, LIVEKIT_API_KEY: undefined, LIVEKIT_API_SECRET: undefined });
    try {
      const response = await respond(true);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "LiveKit is not configured" });
      expect(mocks.respondToTransfer).not.toHaveBeenCalled();
    } finally {
      Object.assign(env, original);
    }
  });
});
