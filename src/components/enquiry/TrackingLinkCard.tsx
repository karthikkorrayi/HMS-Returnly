'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trackingPath } from '@/lib/requests/tracking'

// After a report is sent: the reference, and the private tracking link
// (src/lib/requests/tracking.ts explains why the token is after '#').

export default function TrackingLinkCard({
  reference,
  token,
  kind,
  onAnother,
}: {
  reference: string
  token: string
  kind: 'lost' | 'found'
  onAnother: () => void
}) {
  const path = trackingPath(reference, token)
  const [copied, setCopied] = useState<'ref' | 'link' | null>(null)

  async function copy(what: 'ref' | 'link') {
    try {
      await navigator.clipboard.writeText(what === 'ref' ? reference : `${window.location.origin}${path}`)
      setCopied(what)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className="panel p-5 sm:p-7" role="status" aria-live="polite">
      <p className="text-sm font-semibold text-done">{kind === 'lost' ? 'Report sent' : 'Thank you — report sent'}</p>
      <h3 className="mt-1 text-2xl font-bold">Your reference</h3>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="tag tag-lg select-all">{reference}</span>
        <button type="button" className="btn btn-secondary" onClick={() => copy('ref')}>
          {copied === 'ref' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {kind === 'lost' ? (
        <p className="mt-4 max-w-prose">
          A member of staff will check your report against the items the hotel holds —{' '}
          <strong>this doesn’t mean your item has been found yet</strong>.
        </p>
      ) : (
        <p className="mt-4 max-w-prose">
          <strong>Please hand the item in at the hotel reception</strong> if you haven’t already. The hotel team will
          take it from there; you won’t be put in touch with the owner.
        </p>
      )}
      <h4 className="mt-5 font-bold">Your private tracking link</h4>
      <p className="hint mt-1 max-w-prose">
        Anyone with this link can see this report’s status and messages, so keep it to yourself. It works while the
        report is open and for 30 days after it closes.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Link href={path} className="btn btn-primary">Open tracking page</Link>
        <button type="button" className="btn btn-secondary" onClick={() => copy('link')}>
          {copied === 'link' ? 'Link copied' : 'Copy link'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onAnother}>
          Report another item
        </button>
      </div>
    </div>
  )
}
