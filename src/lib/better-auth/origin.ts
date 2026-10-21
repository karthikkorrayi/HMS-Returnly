// Better Auth 1.7.12's username plugin does not apply the login-CSRF check that
// its email sign-in has (docs/AUTH_SPIKE_REPORT.md §2, finding 3). Every POST
// to /api/auth/* must therefore come from our own site:
//   * if the browser sent an Origin header, it must equal ours;
//   * otherwise the browser must not mark the request cross-site
//     (Sec-Fetch-Site). Non-browser clients send neither header and are allowed
//     (CSRF needs a victim's browser).
export function fromOurSite(req: Request, baseURL: string): boolean {
  const ours = new URL(baseURL).origin
  const origin = req.headers.get('origin')
  if (origin !== null) return origin === ours
  const site = req.headers.get('sec-fetch-site')
  return site === null || site === 'same-origin' || site === 'none'
}

export const crossSiteResponse = () =>
  Response.json({ message: 'Forbidden', code: 'CROSS_SITE_REQUEST' }, { status: 403 })
