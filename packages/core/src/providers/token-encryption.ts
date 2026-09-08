import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encryptToken(token: string, owner: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(owner));
  const value = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), value].map(v => v.toString("base64url")).join(".");
}
export function decryptToken(value: string, owner: string, key: string): string {
  const [iv, tag, encrypted] = value.split(".").map(v => Buffer.from(v, "base64url"));
  if (!iv || !tag || !encrypted) throw new Error("Invalid stored credential");
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString("utf8");
}
