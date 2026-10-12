import { MATCH_BAND_LABEL, REQUEST_STATUS_LABEL, type MatchBand, type RequestStatus } from '@/lib/requests/types'

const STATUS_STYLE: Record<RequestStatus, string> = {
  pending_review: 'bg-attention-soft text-attention',
  under_investigation: 'bg-teal-soft text-teal-dark',
  awaiting_customer: 'bg-paper text-ink border border-line',
  awaiting_admin: 'bg-teal text-white',
  approved: 'bg-done-soft text-done',
  rejected: 'bg-danger-soft text-danger',
  resolved: 'bg-paper text-muted border border-line',
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{REQUEST_STATUS_LABEL[status]}</span>
}

const BAND_STYLE: Record<MatchBand, string> = {
  strong: 'bg-done-soft text-done',
  partial: 'bg-attention-soft text-attention',
  weak: 'bg-paper text-muted border border-line',
}

export function MatchBandBadge({ band }: { band: MatchBand }) {
  return <span className={`badge ${BAND_STYLE[band]}`}>{MATCH_BAND_LABEL[band]}</span>
}
