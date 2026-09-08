import { z } from "zod";
import { parseEnv } from "@receptionist/core/env.js";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  /** Anything not listed gets no access-control-allow-origin header at all. */
  DASHBOARD_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((v) => v.split(",").map((o) => o.trim()).filter(Boolean)),
});

export const env = parseEnv(envSchema, process.env);
