'use client'

import { useEffect, useRef, useState } from 'react'
import { notify } from '@/components/foundora/Toast'
import { useEditBusy } from '@/components/workspace/EditPanel'
import { useRouter } from 'next/navigation'

// Shrinks the logo on the phone (600 px, JPEG on a white background, which
// also drops any hidden metadata), then sends it to /api/brand/logo. The
// server cleans it again and checks the person is a manager.
const MAX_EDGE = 600

async function shrink(file: File, dark: boolean): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) { bitmap.close(); throw new Error('Choose an image with no more than 40 million pixels.') }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process images.')
  ctx.fillStyle = dark ? '#050b20' : '#ffffff' // transparent PNGs become white, as in the emails
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image.'))), 'image/jpeg', 0.9))
}

export default function LogoUploader({ current, dark = false, mark = false }: { current: string | null; dark?: boolean; mark?: boolean }) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  const setEditBusy = useEditBusy()
  useEffect(() => { setEditBusy?.(busy); return () => setEditBusy?.(false) }, [busy, setEditBusy])
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [selected, setSelected] = useState<Blob | null>(null)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function send(method: 'POST' | 'DELETE', body?: Blob) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/brand/logo${mark ? '?variant=mark' : dark ? '?theme=dark' : ''}`, {
        method,
        headers: body ? { 'content-type': 'image/jpeg' } : undefined,
        body,
        credentials: 'same-origin',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) { const text = data.error ?? 'The logo could not be saved.'; setMessage({ ok: false, text }); notify('error', text) }
      else {
        setMessage({ ok: true, text: method === 'POST' ? 'Logo saved.' : 'Logo removed.' })
        setSelected(null)
        setPreview(null)
        notify('success', method === 'POST' ? 'Hotel logo saved.' : 'Hotel logo removed.')
        root.current?.dispatchEvent(new CustomEvent('foundora-form-result', {bubbles:true,detail:{ok:true}}))
        router.refresh()
      }
    } catch {
      notify('error', 'Could not reach the server. The logo change was not confirmed.')
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
    if (file.size > 10 * 1024 * 1024) {
      setMessage({ ok: false, text: 'Choose an image smaller than 10 MB.' }); return
    }
    setMessage(null)
    setBusy(true)
    try {
      const blob = await shrink(file, dark)
      if (blob.size > 1024 * 1024) throw new Error('The processed logo exceeds 1 MB. Choose a simpler image.')
      setSelected(blob)
      setPreview(URL.createObjectURL(blob))
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message })
    } finally { setBusy(false) }
  }

  return (
    <div ref={root} className="space-y-3">
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
      {preview && selected && <div className="logo-pending space-y-2">
        <p className="label">Preview — not saved yet</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, revoked on cleanup */}
        <img src={preview} alt="Selected logo preview" />
        <div className="flex gap-2"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => send('POST', selected)}>Save logo</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setSelected(null); setPreview(null) }}>Cancel</button></div>
      </div>}
      <p className="hint">PNG, JPEG or WebP, up to 10 MB. Resized to 600 px and checked by the server. The default logo is used in emails and as a fallback in dark mode. Logos are public.</p>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-done-soft text-done' : 'bg-danger-soft text-danger'}`}>{message.text}</p>
      )}
    </div>
  )
}
