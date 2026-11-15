import { createClient } from '@supabase/supabase-js';

// Service-role client — bypasses RLS. Server only, never in components.
// Reserved for: ingestion cron routes, scoring RPCs, admin scripts.
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
