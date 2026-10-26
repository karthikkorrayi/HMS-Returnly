// GET /api/health — 200 {"status":"ok"} when the app can reach its database,
// 503 {"status":"unavailable"} otherwise. Public (no session), no details.
import { connection } from 'next/server'
import { withAnon } from '@/lib/db'
import { checkHealth } from '@/lib/health'

export async function GET() {
  await connection() // answer per request, never a cached build-time result
  const { status, httpStatus } = await checkHealth(() => withAnon((tx) => tx.query('select 1')))
  return Response.json({ status }, { status: httpStatus, headers: { 'cache-control': 'no-store' } })
}
