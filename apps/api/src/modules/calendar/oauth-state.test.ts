import { describe, expect, it, vi } from "vitest";
vi.mock("@receptionist/core/env.js", () => ({ env: { TOKEN_ENCRYPTION_KEY: "34".repeat(32) } }));
import { createOAuthState, readOAuthState } from "./oauth-state.js";

describe("Google Calendar OAuth state", () => {
  it("round-trips the authorized agent", () => {
    expect(readOAuthState(createOAuthState("agent-1", "a".repeat(43)), "a".repeat(43))?.agentId).toBe("agent-1");
  });

  it("rejects tampering", () => {
    const state = createOAuthState("agent-1", "a".repeat(43));
    const replacement = state.endsWith("x") ? "y" : "x";
    expect(readOAuthState(`${state.slice(0, -1)}${replacement}`, "a".repeat(43))).toBeNull();
  });

  it("expires after ten minutes", () => {
    vi.useFakeTimers();
    const state = createOAuthState("agent-1", "a".repeat(43));
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(readOAuthState(state, "a".repeat(43))).toBeNull();
    vi.useRealTimers();
  });
});

it("rejects a valid state presented by a different browser", () => {
  const state = createOAuthState("agent-1", "a".repeat(43));
  expect(readOAuthState(state, "b".repeat(43))).toBeNull();
  expect(readOAuthState(state, "")).toBeNull();
  expect(readOAuthState(`${state}.extra`, "a".repeat(43))).toBeNull();
});
