// The private tracking link: /track?ref=<reference>#t=<token>. The token is
// after '#', so the browser never sends it in a page request (and it never
// appears in server or proxy logs); the tracking page reads it and sends it
// in the server action's body. The reference stays separate from the token.
export function trackingPath(reference: string, token: string) {
  return `/track?ref=${encodeURIComponent(reference)}#t=${token}`
}
