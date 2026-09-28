import { STATUS_LABEL, type ItemStatus, type ValueTier, TIER_LABEL } from '@/lib/types'

const STATUS_STYLE: Record<ItemStatus, string> = {
  logged: 'bg-attention-soft text-attention',
  stored: 'bg-paper text-ink border border-line',
  matched: 'bg-teal-soft text-teal-dark',
  guest_contacted: 'bg-teal-soft text-teal-dark',
  awaiting_collection: 'bg-teal text-white',
  awaiting_shipping: 'bg-teal text-white',
  returned: 'bg-done-soft text-done',
  disposed: 'bg-paper text-muted border border-line',
  donated: 'bg-paper text-muted border border-line',
}

export function StatusBadge({ status }: { status: ItemStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
}

export function TierBadge({ tier }: { tier: ValueTier }) {
  if (tier === 'standard') return null
  return (
    <span
      className={`badge ${
        tier === 'sensitive' ? 'bg-danger-soft text-danger' : 'bg-attention-soft text-attention'
      }`}
    >
      {TIER_LABEL[tier]}
    </span>
  )
}
