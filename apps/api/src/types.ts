import type { Context } from "hono";

export type AppVariables = { agentId: string; authUser: import("@receptionist/core/providers/supabase.js").AuthenticatedUser };
export type AppEnv = { Variables: AppVariables };
export type AppContext = Context<AppEnv>;
