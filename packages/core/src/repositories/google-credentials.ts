import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { googleCredentials } from "../db/schema.js";

export async function getGoogleCredentials(authUserId: string) {
  const [row] = await db.select().from(googleCredentials).where(eq(googleCredentials.authUserId, authUserId));
  return row ?? null;
}
export async function saveGoogleCredentials(authUserId: string, googleSubject: string, encryptedRefreshToken: string) {
  const values = { authUserId, googleSubject, encryptedRefreshToken, updatedAt: new Date() };
  await db.insert(googleCredentials).values(values).onConflictDoUpdate({ target: googleCredentials.authUserId, set: values });
}
export async function deleteGoogleCredentials(authUserId: string) {
  await db.delete(googleCredentials).where(eq(googleCredentials.authUserId, authUserId));
}
