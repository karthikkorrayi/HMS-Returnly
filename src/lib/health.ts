// The health check Railway calls before switching traffic to a new deploy
// (and that monitoring can call any time). It answers only "ok" or
// "unavailable": no versions, hostnames or error details for strangers.
// No Next.js imports, so it can be unit tested.

export const HEALTH_TIMEOUT_MS = 2000

export type Health = { status: 'ok' | 'unavailable'; httpStatus: 200 | 503 }

/** Runs `probe` (a tiny database query) and gives up after `timeoutMs`. */
export async function checkHealth(probe: () => Promise<unknown>, timeoutMs = HEALTH_TIMEOUT_MS): Promise<Health> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  try {
    const result = await Promise.race([probe().then(() => 'ok' as const), timedOut])
    if (result === 'ok') return { status: 'ok', httpStatus: 200 }
    console.error(`health check: database did not answer within ${timeoutMs} ms`)
  } catch (e) {
    // Only the error code (e.g. ECONNREFUSED), never a message with addresses.
    console.error(`health check: database unreachable (${(e as { code?: string })?.code ?? 'error'})`)
  } finally {
    clearTimeout(timer)
  }
  return { status: 'unavailable', httpStatus: 503 }
}
