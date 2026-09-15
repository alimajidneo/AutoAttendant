import { describe, expect, it } from "vitest";
import { createCalcomOAuthCapabilities, hashCalcomOAuthCapability } from "./oauth-state.js";

describe("employee Cal.com OAuth state", () => {
  it("creates independent high-entropy opaque state and browser bindings and stores only hashes", () => {
    const first = createCalcomOAuthCapabilities();
    const second = createCalcomOAuthCapabilities();
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.browserChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.state).not.toBe(first.browserChallenge);
    expect(second.state).not.toBe(first.state);
    expect(first.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.stateHash).toBe(hashCalcomOAuthCapability(first.state));
    expect(first.stateHash).not.toContain(first.state);
  });

  it("rejects malformed capabilities before database lookup", () => {
    expect(hashCalcomOAuthCapability("short")).toBeNull();
    expect(hashCalcomOAuthCapability("x".repeat(44))).toBeNull();
  });
});
