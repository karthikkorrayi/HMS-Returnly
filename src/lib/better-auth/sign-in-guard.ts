// Sign-in protection (Phase 6), on top of Better Auth's per-address limit:
//   * a wrong-password lock per USERNAME (10 wrong in 15 minutes -> locked for
//     15 minutes), because on the hotel Wi-Fi every phone shares one address;
//   * blocked (deactivated) logins never get a session.
// Uses the auth_service pool and the tables in
// db/migrations/20261026000011_sign_in_guard.sql. No Next.js imports.
import { USERNAME_PATTERN } from './rules'

export const MAX_FAILURES = 10
export const FAILURE_WINDOW_MINUTES = 15
export const LOCK_MINUTES = 15

export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>

/** The username as sign-in sees it, or null if it cannot be a valid username. */
export function guardKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const u = raw.trim().toLowerCase()
  return USERNAME_PATTERN.test(u) ? u : null
}

export function makeSignInGuard(query: Query) {
  return {
    /** Minutes left on the lock, or 0 if this username may try now. */
    async lockedMinutes(username: string): Promise<number> {
      const r = await query(
        `select ceil(extract(epoch from (locked_until - now())) / 60)::int as m
           from auth.sign_in_failures where username = $1 and locked_until > now()`,
        [username]
      )
      return (r.rows[0]?.m as number | undefined) ?? 0
    },

    /** Counts one wrong password; locks the username at MAX_FAILURES. */
    async recordFailure(username: string): Promise<{ failures: number; locked: boolean }> {
      const r = await query(
        `insert into auth.sign_in_failures as f (username, failures, first_failed_at)
         values ($1, 1, now())
         on conflict (username) do update set
           failures = case when f.first_failed_at < now() - make_interval(mins => $2) then 1 else f.failures + 1 end,
           first_failed_at = case when f.first_failed_at < now() - make_interval(mins => $2) then now() else f.first_failed_at end,
           locked_until = case
             when (case when f.first_failed_at < now() - make_interval(mins => $2) then 1 else f.failures + 1 end) >= $3
               then now() + make_interval(mins => $4)
             else f.locked_until end
         returning failures, locked_until > now() as locked`,
        [username, FAILURE_WINDOW_MINUTES, MAX_FAILURES, LOCK_MINUTES]
      )
      // Housekeeping: forget old, unlocked entries (keeps the table small even
      // if someone tries thousands of made-up usernames).
      await query(
        `delete from auth.sign_in_failures
          where first_failed_at < now() - interval '1 day' and (locked_until is null or locked_until < now())`
      )
      const row = r.rows[0] as { failures: number; locked: boolean | null }
      return { failures: row.failures, locked: row.locked === true }
    },

    /** A correct password (or a manager's reset) clears the count and any lock. */
    async clear(username: string): Promise<void> {
      await query(`delete from auth.sign_in_failures where username = $1`, [username])
    },

    /** True if this login belongs to a deactivated staff member. */
    async isBlocked(userId: string): Promise<boolean> {
      const r = await query(`select blocked from auth.users where id = $1`, [userId])
      return r.rows[0]?.blocked === true
    },
  }
}

export type SignInGuard = ReturnType<typeof makeSignInGuard>
