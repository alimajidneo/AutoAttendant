import { z } from "zod";
import { parseEnv } from "@receptionist/core/env.js";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  /** Anything not listed gets no access-control-allow-origin header at all. */
  DASHBOARD_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((v) => v.split(",").map((o) => o.trim()).filter(Boolean)),
  /** Public API origin used in Google's exact-match OAuth redirect URI. */
  PUBLIC_API_URL: z.string().url().optional(),
});

export const env = parseEnv(envSchema, process.env);
