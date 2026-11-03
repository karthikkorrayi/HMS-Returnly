// Settings → Emails: the hotel's customer-email log, for managers. Read through
// row-level security (email_outbox_select, migration 017): only this hotel's
// rows, managers only. The stored copy never contains the private link.
// No Next.js imports, so tests can run it.
import type { Tx } from '@/lib/db/core'

export type EmailLogRow = {
  id: number
  created_at: string
  sent_at: string | null
  template: string
  status: string
  recipient: string
  subject: string | null
  body_text: string | null
  attempts: number
  last_error: string | null
  reference: string
}

export const EMAIL_TEMPLATE_LABEL: Record<string, string> = {
  received: 'Report received',
  under_review: 'Under review',
  contact_required: 'Contact required',
  staff_message: 'New message',
  matched: 'Matched',
  closed: 'Closed',
  resolved: 'Resolved',
}

export const EMAIL_STATUS_LABEL: Record<string, string> = {
  queued: 'Waiting to send',
  sending: 'Sending',
  retry: 'Will retry',
  sent: 'Sent',
  previewed: 'Preview only (not sent)',
  skipped: 'Not sent (not on the staging allowlist)',
  suppressed: 'Not sent (address bounced before)',
  failed: 'Failed',
  expired: 'Not sent (too old)',
}

/** a.guest@example.com → a••••t@example.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return '••••'
  return user.length <= 2 ? `${user[0] ?? ''}•@${domain}` : `${user[0]}••••${user.at(-1)}@${domain}`
}

export async function loadEmailLog(tx: Tx, limit = 50): Promise<EmailLogRow[]> {
  const { rows } = await tx.query<EmailLogRow>(
    `select o.id::float8 as id, o.created_at, o.sent_at, o.template, o.status, o.recipient, o.subject, o.body_text,
            o.attempts, o.last_error, r.reference
       from public.email_outbox o join public.customer_requests r on r.id = o.request_id
      order by o.id desc limit $1`,
    [Math.min(Math.max(limit, 1), 200)]
  )
  return rows
}
