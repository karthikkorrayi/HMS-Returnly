import { createBrowserClient } from '@supabase/ssr'

// Browser client — used for direct uploads to the private photo bucket.
// Row-level security decides what it can read and write.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
