import type { Context } from "hono";

export type AppVariables = { workspaceRole: "manager" | "member"; workspaceOwner: boolean; agentId: string; authUser: import("@receptionist/core/providers/supabase.js").AuthenticatedUser };
export type AppEnv = { Variables: AppVariables };
export type AppContext = Context<AppEnv>;
