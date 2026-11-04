'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Shrinks the logo on the phone (600 px, JPEG on a white background, which
// also drops any hidden metadata), then sends it to /api/brand/logo. The
// server cleans it again and checks the person is a manager.
const MAX_EDGE = 600

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process images.')
  ctx.fillStyle = '#ffffff' // transparent PNGs become white, as in the emails
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image.'))), 'image/jpeg', 0.9))
}

export default function LogoUploader({ current }: { current: string | null }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function send(method: 'POST' | 'DELETE', body?: Blob) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/brand/logo', {
        method,
        headers: body ? { 'content-type': 'image/jpeg' } : undefined,
        body,
        credentials: 'same-origin',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setMessage({ ok: false, text: data.error ?? 'That didn’t work. Please try again.' })
      else {
        setMessage({ ok: true, text: method === 'POST' ? 'Logo saved.' : 'Logo removed.' })
        router.refresh()
      }
    } catch {
      setMessage({ ok: false, text: 'Could not reach the server. Check your connection and try again.' })
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setMessage({ ok: false, text: 'Choose a PNG, JPEG or WebP image.' })
      return
    }
    try {
      await send('POST', await shrink(file))
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-40 items-center justify-center rounded-lg border border-line bg-white p-2">
          {current
            // eslint-disable-next-line @next/next/no-img-element -- the hotel's own logo, served by this app
            ? <img src={current} alt="Current logo" className="max-h-12 max-w-36 object-contain" />
            : <span className="text-sm text-muted">No logo</span>}
        </div>
        <label className="btn btn-secondary cursor-pointer">
          {busy ? 'Saving…' : current ? 'Replace logo' : 'Upload logo'}
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={onPick} disabled={busy} />
        </label>
        {current && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => send('DELETE')}>Remove</button>
        )}
      </div>
      <p className="hint">PNG, JPEG or WebP. It is shrunk to 600 px and shown on a white background in emails and on your hotel’s page. Public: anyone can see it.</p>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-done-soft text-done' : 'bg-danger-soft text-danger'}`}>{message.text}</p>
      )}
    </div>
  )
}
