import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "./token-encryption.js";

describe("Calendar credential encryption", () => {
  const key = randomBytes(32).toString("hex");
  it("encrypts with a fresh nonce and restores the owner's token", () => {
    const a = encryptToken("refresh-token", "owner-a", key);
    expect(a).not.toContain("refresh-token");
    expect(a).not.toBe(encryptToken("refresh-token", "owner-a", key));
    expect(decryptToken(a, "owner-a", key)).toBe("refresh-token");
  });
  it("rejects another owner, another key, and modified ciphertext", () => {
    const value = encryptToken("refresh-token", "owner-a", key);
    expect(() => decryptToken(value, "owner-b", key)).toThrow();
    expect(() => decryptToken(value, "owner-a", randomBytes(32).toString("hex"))).toThrow();
    const parts = value.split(".");
    parts[2] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken(parts.join("."), "owner-a", key)).toThrow();
  });
});
