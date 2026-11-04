// Audit log of staff opening customers' reports (migration 020). Written on
// every report page view (at most once per person per report per 10 minutes);
// read by managers on Settings → Access log. No Next.js imports, so tests can
// run it.
import type { Tx } from '@/lib/db/core'

export type AccessLogRow = { id: number; created_at: string; reference: string; staff_name: string; action: string; request_id: string | null }

export async function logReportView(tx: Tx, requestId: string): Promise<void> {
  await tx.rpc('log_report_view', { p_request_id: requestId })
}

export async function loadAccessLog(tx: Tx, limit = 100): Promise<AccessLogRow[]> {
  const { rows } = await tx.query<AccessLogRow>(
    `select a.id::float8 as id, a.created_at, a.reference, a.action, a.request_id,
            coalesce(s.display_name, 'Former staff') as staff_name
       from public.customer_data_access a left join public.staff s on s.user_id = a.staff_id
      order by a.id desc limit $1`,
    [Math.min(Math.max(limit, 1), 500)]
  )
  return rows
}
