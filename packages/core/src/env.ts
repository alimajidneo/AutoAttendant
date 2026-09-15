import { z } from "zod";

/**
 * Reads `process.env` only. Files are a development convenience loaded by each
 * app's dev script with `--env-file`, and by `env_file:` in Docker Compose.
 */
export const coreEnvSchema = z
  .object({
    CALCOM_API_BASE_URL: z.string().regex(/^https:\/\/api\.cal\.com\/v2\/?$/, "Use https://api.cal.com/v2").default("https://api.cal.com/v2").transform(() => "https://api.cal.com/v2"),
    CALCOM_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    CALCOM_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    CALCOM_OAUTH_WRITE_APPROVED: z.preprocess(value => typeof value === "boolean" ? String(value) : value,
      z.enum(["true", "false"]).default("false")).transform(value => value === "true"),
    CRON_SECRET: z.string().min(32).optional(),
    CALCOM_WEBHOOK_SECRET: z.string().min(32).optional(),
    RETELL_WORKSPACE_ID: z.string().uuid().optional(),
    RETELL_AGENT_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional(),
    RETELL_API_KEY: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),
    LIVEKIT_URL: z.string().min(1),
    LIVEKIT_API_KEY: z.string().min(1),
    LIVEKIT_API_SECRET: z.string().min(1),
    SUPABASE_URL: z.string().url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
    MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
    SLACK_CLIENT_ID: z.string().min(1).optional(),
    SLACK_CLIENT_SECRET: z.string().min(1).optional(),
    TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    /** All four or none. A partial set reads as configured and fails per call. */
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET_NAME: z.string().min(1).optional(),
  })
  .superRefine((cfg, ctx) => {
    if (!!cfg.CALCOM_OAUTH_CLIENT_ID !== !!cfg.CALCOM_OAUTH_CLIENT_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [cfg.CALCOM_OAUTH_CLIENT_ID ? "CALCOM_OAUTH_CLIENT_SECRET" : "CALCOM_OAUTH_CLIENT_ID"],
        message: "Set both Cal.com OAuth client variables, or neither" });
    }
    const r2 = [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
    ] as const;
    const set = r2.filter((key) => cfg[key]);
    if (set.length === 0 || set.length === r2.length) return;
    for (const key of r2.filter((k) => !cfg[k])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "Set all four R2_* variables, or none to run without recording",
      });
    }
  });

/** Blank counts as unset, so `FOO=` falls through to `.optional()`. Throws
 *  rather than exiting, so importing this never kills the test runner. */
export function parseEnv<T extends z.ZodTypeAny>(schema: T, source: unknown): z.infer<T> {
  const present = Object.fromEntries(
    Object.entries(source as Record<string, unknown>).filter(([, v]) => v !== "")
  );
  const parsed = schema.safeParse(present);
  if (parsed.success) return parsed.data;

  const detail = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${detail}`);
}

export const env = parseEnv(coreEnvSchema, process.env);
