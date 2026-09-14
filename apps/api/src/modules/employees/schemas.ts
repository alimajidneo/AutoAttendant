import { z } from "zod";
import { businessHoursSchema } from "../../schemas.js";
const interval = z.object({ start: z.string(), end: z.string() }).strict();
const day = z.array(interval).max(12);
const workingHours = z.object({
  weekly: z.object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }).strict(),
  exceptions: z.array(z.object({ date: z.string(), intervals: day, label: z.string().max(100).optional() }).strict()).max(366),
}).strict().pipe(businessHoursSchema);
export const employeeDraft = z.object({
  displayName: z.string().trim().min(1).max(80),
  department: z.string().trim().max(80).nullable().optional(),
  routingEnabled: z.boolean().optional(),
  manualAvailability: z.enum(["available", "unavailable", "unknown"]).optional(),
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
  workingHours: workingHours.optional(),
  transferNumber: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional(),
}).strict();
export const employeePatch = employeeDraft.partial().refine(value => Object.keys(value).length > 0);
const reference = z.object({ connectionId: z.string().uuid(), calendarId: z.string().trim().min(1).max(1024) }).strict();
const url = z.string().max(2048).url().pipe(z.string().refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password;
}));
export const employeePolicy = z.discriminatedUnion("authority", [
  z.object({ authority: z.literal("direct"), booking: reference.nullable(), conflicts: z.array(reference).max(50) }).strict(),
  z.object({ authority: z.literal("calcom"), eventType: z.string().trim().min(1).max(200).nullable(), bookingUrl: url.nullable() }).strict(),
]).refine(policy => policy.authority !== "calcom" || !!(policy.eventType || policy.bookingUrl));
