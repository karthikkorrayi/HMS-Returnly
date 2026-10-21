// Better Auth's HTTP endpoints (sign-in, sign-out, session). Every POST must
// come from our own site — see src/lib/better-auth/origin.ts for why.
import { toNextJsHandler } from 'better-auth/next-js'
import { authBaseURL, getAuth } from '@/lib/better-auth/instance'
import { crossSiteResponse, fromOurSite } from '@/lib/better-auth/origin'

export async function GET(req: Request) {
  return toNextJsHandler(await getAuth()).GET(req)
}

export async function POST(req: Request) {
  if (!fromOurSite(req, authBaseURL())) return crossSiteResponse()
  return toNextJsHandler(await getAuth()).POST(req)
}
