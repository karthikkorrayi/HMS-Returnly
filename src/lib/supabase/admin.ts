import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service-role client. Bypasses row-level security, so it is used ONLY for
// creating/disabling staff logins, and only after the caller has been
// verified as a manager. Never import this from a Client Component.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
