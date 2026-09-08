import { createClient } from "@supabase/supabase-js";
import { env } from "../env.js";

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export type { User as AuthenticatedUser } from "@supabase/supabase-js";
