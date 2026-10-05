'use client'

import { useState } from 'react'
import Link from 'next/link'
import ReturnlyIcon from './ReturnlyIcon'
import { StatusBadge, TierBadge } from './Badges'
import { CLOSED_STATUSES, type ItemStatus, type ValueTier } from '@/lib/types'

type PreviewItem = {
  code: string
  description: string
  category: string
  location: string
  status: ItemStatus
  tier: ValueTier
  retention?: boolean
  nextStep: string
}

// Fictional examples only. This component never queries hotel records.
const SAMPLE_ITEMS: PreviewItem[] = [
  {
    code: 'SAMPLE-001', description: 'Wireless headphones',
    category: 'Electronics', location: 'Room 204',
    status: 'logged', tier: 'valuable',
    nextStep: 'Store in a secure location and record the move before matching to a reservation.',
  },
  {
    code: 'SAMPLE-002', description: 'Blue linen shirt',
    category: 'Clothing', location: 'Room 118',
    status: 'awaiting_collection', tier: 'standard',
    nextStep: 'The front desk checks the guest’s ID against the reservation in the PMS and records the handover.',
  },
  {
    code: 'SAMPLE-003', description: 'Passport',
    category: 'Documents & cards', location: 'Lobby',
    status: 'logged', tier: 'sensitive',
    nextStep: 'Store securely. Do not photograph this item. A second staff member must witness its eventual handover.',
  },
  {
    code: 'SAMPLE-004', description: 'Travel charger',
    category: 'Chargers & cables', location: 'Room 302',
    status: 'stored', tier: 'standard', retention: true,
    nextStep: 'The retention period has passed. A manager can review disposal or donation with a witness.',
  },
  {
    code: 'SAMPLE-005', description: 'Silver wristwatch',
    category: 'Jewellery & watches', location: 'Restaurant',
    status: 'awaiting_shipping', tier: 'valuable',
    nextStep: 'The front desk records courier tracking and a second staff witness when posting the item.',
  },
  {
    code: 'SAMPLE-006', description: 'Canvas tote bag',
    category: 'Bags', location: 'Room 216',
    status: 'matched', tier: 'standard',
    nextStep: 'The front desk contacts the guest through the PMS and records how they were contacted.',
  },
  {
    code: 'SAMPLE-007', description: 'Children’s storybook',
    category: 'Books', location: 'Lobby',
    status: 'returned', tier: 'standard',
    nextStep: 'This item has been returned. Its custody record is kept for reference.',
  },
]

const FILTERS = [
  { id: 'open', label: 'All open' },
  { id: 'storage', label: 'Needs storage' },
  { id: 'return', label: 'Ready to return' },
  { id: 'retention', label: 'Retention review' },
  { id: 'closed', label: 'Closed' },
] as const

type Filter = (typeof FILTERS)[number]['id']

function matchesFilter(item: PreviewItem, filter: Filter) {
  switch (filter) {
    case 'open': return !CLOSED_STATUSES.includes(item.status)
    case 'storage': return item.status === 'logged'
    case 'return':
      return item.status === 'awaiting_collection' ||
        item.status === 'awaiting_shipping'
    case 'retention': return Boolean(item.retention)
    case 'closed': return CLOSED_STATUSES.includes(item.status)
  }
}

const CARDS = [
  { id: 'open', label: 'Open items', icon: 'box', note: 'Safely in your team’s care', tone: 'teal' },
  { id: 'storage', label: 'Needs storage', icon: 'tag', note: 'Find a safe place first', tone: 'amber' },
  { id: 'return', label: 'Ready to return', icon: 'check', note: 'Collection or posting', tone: 'green' },
  { id: 'retention', label: 'Retention review', icon: 'clock', note: 'For a manager to review', tone: 'amber' },
] as const

export default function DashboardPreview() {
  const [filter, setFilter] = useState<Filter>('open')
  const [search, setSearch] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  const counts = Object.fromEntries(
    FILTERS.map(({ id }) => [
      id,
      SAMPLE_ITEMS.filter((item) => matchesFilter(item, id)).length,
    ])
  ) as Record<Filter, number>

  const query = search.trim().toLowerCase()
  const visible = SAMPLE_ITEMS.filter(
    (item) =>
      matchesFilter(item, filter) &&
      `${item.code} ${item.description} ${item.location} ${item.category}`
        .toLowerCase().includes(query)
  )
  const selected =
    visible.find((item) => item.code === selectedCode) ?? visible[0]

  function chooseFilter(value: Filter) {
    setFilter(value)
    setSelectedCode(null)
  }

  return (
    <section
      id="workspace-preview"
      className="scroll-mt-6 pt-10"
      aria-labelledby="workspace-title"
    >
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">
            A calmer shift starts here
          </p>
          <h2 id="workspace-title" className="text-2xl font-bold tracking-tight">
            Your lost &amp; found, at a glance
          </h2>
        </div>
        <span className="preview-label">
          <span className="size-1.5 rounded-full bg-teal" />
          Interactive preview · Sample data
        </span>
      </div>

      <p className="mb-5 text-sm text-muted">
        Explore fictional items below. Select a summary or filter, then choose
        an item to see its next step.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => chooseFilter(card.id)}
            aria-pressed={filter === card.id}
            aria-controls="preview-items"
            className={`summary-card ${filter === card.id ? 'summary-card-active' : ''}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-muted">{card.label}</span>
              <span className={`summary-icon summary-icon-${card.tone}`}>
                <ReturnlyIcon name={card.icon} />
              </span>
            </span>
            <span className="mt-3 block text-3xl font-bold tracking-tight">
              {counts[card.id]}{' '}
              <span className="text-xs font-normal tracking-normal text-muted">
                sample items
              </span>
            </span>
            <span className="mt-2 flex items-center justify-between text-xs text-muted">
              {card.note}
              <ReturnlyIcon name="arrow" className="!size-4" />
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="panel min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <h3 className="font-bold">The action board</h3>
            <div className="relative w-full sm:w-64">
              <label htmlFor="preview-search" className="sr-only">
                Search sample items
              </label>
              <ReturnlyIcon
                name="search"
                className="absolute left-3 top-3 !size-4 text-muted"
              />
              <input
                id="preview-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="field !min-h-10 !py-2 pl-9 !text-sm"
                placeholder="Search item, room or code"
              />
            </div>
          </div>

          <div
            className="overflow-x-auto px-5 pb-4 pt-4"
            role="group"
            aria-label="Filter sample items"
          >
            <div className="flex w-max gap-2">
              {FILTERS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => chooseFilter(id)}
                  aria-pressed={filter === id}
                  aria-controls="preview-items"
                  className={`preview-filter ${filter === id ? 'preview-filter-active' : ''}`}
                >
                  {label}{' '}
                  <span className="ml-2 opacity-70">{counts[id]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-y border-line bg-paper px-5 py-2 text-xs text-muted">
            <span>Sample item / Found in</span>
            <span>Select to explore</span>
          </div>

          <ul id="preview-items" className="divide-y divide-line">
            {visible.map((item) => (
              <li key={item.code}>
                <button
                  type="button"
                  onClick={() => setSelectedCode(item.code)}
                  aria-pressed={selected?.code === item.code}
                  aria-controls="preview-next-step"
                  className={`preview-row ${selected?.code === item.code ? 'preview-row-selected' : ''}`}
                >
                  <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
                    item.tier === 'sensitive'
                      ? 'bg-attention-soft text-attention'
                      : 'bg-paper text-teal'
                  }`}>
                    <ReturnlyIcon name={item.tier === 'sensitive' ? 'shield' : 'tag'} />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold">
                      {item.description}
                    </span>
                    <span className="mt-1 block text-xs text-muted">
                      {item.location} · {item.code}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1 sm:hidden">
                      <StatusBadge status={item.status} />
                      {item.retention && (
                        <span className="badge bg-attention-soft text-attention">
                          Past retention
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="hidden flex-col items-end gap-1 sm:flex">
                    <StatusBadge status={item.status} />
                    {item.retention && (
                      <span className="badge bg-attention-soft text-attention">
                        Past retention
                      </span>
                    )}
                  </span>
                  <ReturnlyIcon name="arrow" className="!size-4 text-muted" />
                </button>
              </li>
            ))}
          </ul>

          {visible.length === 0 && (
            <div className="px-5 py-10 text-center">
              <p className="font-semibold">No sample items match.</p>
              <p className="mt-2 text-sm text-muted">
                Try another search or reset the board.
              </p>
              <button
                type="button"
                className="btn btn-secondary mt-4"
                onClick={() => { setSearch(''); chooseFilter('open') }}
              >
                Reset filters
              </button>
            </div>
          )}

          <p
            aria-live="polite"
            aria-atomic="true"
            className="border-t border-line px-5 py-3 text-xs text-muted"
          >
            Showing {visible.length} of {counts[filter]} sample items in{' '}
            {FILTERS.find(({ id }) => id === filter)?.label.toLowerCase()}.
          </p>
        </div>

        <aside className="space-y-4" aria-label="Item guidance and quick actions">
          <section
            id="preview-next-step"
            className="panel p-5"
            aria-labelledby="next-step-title"
          >
            <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal">
              <ReturnlyIcon name="grid" className="!size-4" />
              Preview / Next step
            </p>
            <div aria-live="polite" aria-atomic="true">
              <h3 id="next-step-title" className="text-lg font-bold">
                {selected ? selected.description : 'Choose a sample item'}
              </h3>
              {selected ? (
                <>
                  <p className="mb-3 mt-1 text-xs text-muted">
                    {selected.code} · {selected.location}
                  </p>
                  <TierBadge tier={selected.tier} />
                  <p className="mt-4 text-sm leading-relaxed text-muted">
                    {selected.nextStep}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  Reset the search or switch filters to explore the workflow.
                </p>
              )}
            </div>
            <Link href="/login" className="btn btn-secondary mt-5 w-full text-sm">
              Sign in to manage items
              <ReturnlyIcon name="arrow" className="!size-4" />
            </Link>
          </section>

          <section
            className="rounded-xl bg-teal p-5 text-white"
            aria-labelledby="quick-actions-title"
          >
            <h3 id="quick-actions-title" className="font-bold">Make the next move</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/80">
              Ready for your shift? Your hotel’s workspace is one sign-in away.
            </p>
            <div className="mt-4 space-y-2">
              <Link href="/login?next=/items/new" className="quick-action">
                <span className="flex items-center gap-2">
                  <ReturnlyIcon name="plus" className="!size-4" />Log a found item
                </span>
                <ReturnlyIcon name="arrow" className="!size-4" />
              </Link>
              <Link href="/login?next=/items" className="quick-action">
                <span className="flex items-center gap-2">
                  <ReturnlyIcon name="search" className="!size-4" />Find an item
                </span>
                <ReturnlyIcon name="arrow" className="!size-4" />
              </Link>
            </div>
            <p className="mt-4 text-xs text-white/75">
              These actions require staff sign-in.
            </p>
          </section>
        </aside>
      </div>
    </section>
  )
}
