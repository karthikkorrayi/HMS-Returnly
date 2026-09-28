import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Short-lived signed URLs for private photos. RLS on storage.objects decides
// which paths the signed-in staff member is allowed to sign.
export async function signPhotoUrls(
  supabase: SupabaseClient,
  paths: string[],
  expiresIn = 60 * 30
): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from('item-photos').createSignedUrls(paths, expiresIn)
  if (error || !data) return {}
  const urls: Record<string, string> = {}
  for (const entry of data) {
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl
  }
  return urls
}
