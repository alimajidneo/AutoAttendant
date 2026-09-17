import { z } from "zod";
import { parseEnv } from "@receptionist/core/env.js";

function isProductionOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const local = hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname === "0.0.0.0"
      || hostname === "[::1]"
      || /^127(?:\.\d{1,3}){3}$/.test(hostname);
    return url.protocol === "https:"
      && !local
      && !url.username
      && !url.password
      && url.pathname === "/"
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  VERCEL: z.string().min(1).optional(),
  /** Anything not listed gets no access-control-allow-origin header at all. */
  DASHBOARD_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((v) => v.split(",").map((o) => o.trim()).filter(Boolean)),
  /** Public API origin used in Google's exact-match OAuth redirect URI. */
  PUBLIC_API_URL: z.string().url().optional(),
}).superRefine((cfg, ctx) => {
  if (!cfg.VERCEL) return;
  if (!cfg.PUBLIC_API_URL) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PUBLIC_API_URL"], message: "Required on Vercel" });
  } else if (!isProductionOrigin(cfg.PUBLIC_API_URL)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PUBLIC_API_URL"], message: "Must be a non-local HTTPS origin without credentials, path, query, or fragment" });
  }
  if (cfg.DASHBOARD_ORIGINS.length === 0
    || (cfg.DASHBOARD_ORIGINS.length === 1 && cfg.DASHBOARD_ORIGINS[0] === "http://localhost:5173")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["DASHBOARD_ORIGINS"], message: "Required on Vercel" });
  } else if (cfg.DASHBOARD_ORIGINS.some((origin) => !isProductionOrigin(origin))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["DASHBOARD_ORIGINS"], message: "Every entry must be a non-local HTTPS origin without credentials, path, query, or fragment" });
  }
});

export const env = parseEnv(envSchema, process.env);
