// When the "Preparing your workspace" intro (src/components/workspace/AppEntry.tsx)
// is shown. Pure (no Next.js), so tests can use it.
//
//   * Only on staff workspace pages (/h/<slug>/items, …). src/proxy.ts tells
//     the page its staff path in the x-foundora-path header (set only there;
//     copies sent by the browser are removed). Guest pages — /h/<slug>,
//     /h/<slug>/found, /track, the sign-in pages — never show it, so a guest
//     opening a tracking link from an email sees the page at once.
//   * At most once per browser session: the intro sets a session cookie
//     (no personal data: the value is just "1") and later full page loads skip it.
//   * Short, and "Continue now" always ends it.

export const ENTRY_COOKIE = 'fo_entry'
export const ENTRY_MS = 1200

const STAFF = /^\/(items|requests|staff|settings|support|account|notifications)(\/|$)/

/** staffPath: the x-foundora-path header (null on guest pages). seen: the cookie is set. */
export function showsEntry(staffPath: string | null | undefined, seen: boolean): boolean {
  if (seen || !staffPath) return false
  return STAFF.test(staffPath.split('?')[0])
}

/** The cookie the intro sets once shown: this browser session only. */
export function entryCookie(https: boolean): string {
  return `${ENTRY_COOKIE}=1; Path=/; SameSite=Lax${https ? '; Secure' : ''}`
}
