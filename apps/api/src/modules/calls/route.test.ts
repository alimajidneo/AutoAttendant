import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types.js";

const mocks = vi.hoisted(() => ({
  listCalls: vi.fn(),
  getCallById: vi.fn(),
  getPresignedRecordingUrl: vi.fn(),
}));

vi.mock("@receptionist/core/repositories/calls.js", () => ({
  listCalls: mocks.listCalls,
  getCallById: mocks.getCallById,
}));
vi.mock("@receptionist/core/providers/storage.js", () => ({
  getPresignedRecordingUrl: mocks.getPresignedRecordingUrl,
}));

import { calls } from "./route.js";

function app(role: "manager" | "member") {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("agentId", "workspace-1");
      c.set("workspaceRole", role);
      c.set("workspaceOwner", role === "manager");
      c.set("authUser", { id: `${role}-1` } as never);
      await next();
    })
    .route("/calls", calls);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listCalls.mockResolvedValue([{ id: "call-1", summary: "Asked for a demo" }]);
  mocks.getCallById.mockResolvedValue({ id: "call-1", transcript: [], recordingKey: "recording" });
});

describe("workspace call access", () => {
  it("lets members read the workspace call log", async () => {
    const response = await app("member").request("/calls");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "call-1", summary: "Asked for a demo" }]);
    expect(mocks.listCalls).toHaveBeenCalledWith("workspace-1", 50, 0);
  });

  it("keeps transcripts and recordings manager-only", async () => {
    expect((await app("member").request("/calls/call-1")).status).toBe(403);
    expect((await app("member").request("/calls/call-1/recording")).status).toBe(403);
    expect(mocks.getCallById).not.toHaveBeenCalled();
    expect(mocks.getPresignedRecordingUrl).not.toHaveBeenCalled();
  });

  it("lets a manager open call detail", async () => {
    expect((await app("manager").request("/calls/call-1")).status).toBe(200);
    expect(mocks.getCallById).toHaveBeenCalledWith("call-1", "workspace-1");
  });
});
