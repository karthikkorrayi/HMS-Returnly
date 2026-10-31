// The daily clean-up's status for managers (Settings page). The clean-up
// itself runs outside the app (scripts/daily-cleanup.mjs, a Railway cron
// service); this only reads when it last succeeded, so a job that stopped
// running is noticed. No Next.js imports, so tests can run it.
import type { Tx } from '@/lib/db/core'

/** A run is "late" after a day and a half: one missed daily run plus slack. */
export const LATE_AFTER_HOURS = 36

export type CleanupStatus =
  | { state: 'ok'; at: Date; text: string }
  | { state: 'late'; at: Date; text: string }
  | { state: 'never'; at: null; text: string }

const ago = (ms: number) => {
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return 'less than an hour ago'
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  return `${Math.floor(h / 24)} days ago`
}

export function cleanupStatus(lastFinished: Date | null, now: Date = new Date()): CleanupStatus {
  if (!lastFinished) {
    return { state: 'never', at: null, text: 'The daily clean-up has not run yet. Expired records are not being removed: check the “daily-cleanup” service on Railway.' }
  }
  const age = now.getTime() - lastFinished.getTime()
  if (age > LATE_AFTER_HOURS * 3_600_000) {
    return { state: 'late', at: lastFinished, text: `The daily clean-up last ran ${ago(age)}. It should run every night: check the “daily-cleanup” service on Railway.` }
  }
  return { state: 'ok', at: lastFinished, text: `Last ran ${ago(Math.max(0, age))}.` }
}

export async function loadLastCleanup(tx: Tx): Promise<Date | null> {
  const { rows } = await tx.query<{ finished_at: Date | string | null }>('select finished_at from public.last_cleanup()')
  const v = rows[0]?.finished_at
  return v ? new Date(v) : null
}
