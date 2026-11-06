'use client'
import { useEffect, useId, useRef, useState } from 'react'
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => { const el = ref.current; if (open && !el?.open) el?.showModal(); if (!open && el?.open) el.close() }, [open])
  return <dialog ref={ref} className="workspace-dialog" aria-labelledby={id} onClose={onClose}>
    <header className="workspace-dialog-header"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={() => ref.current?.close()}>×</button></header>
    <div className="workspace-dialog-body">{children}</div>
  </dialog>
}
export function ModalTrigger({ label, title, children, closeOnSave = false }: { label: string; title: string; children: React.ReactNode; closeOnSave?: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = root.current
    function result(e: Event) { if (closeOnSave && (e as CustomEvent).detail?.ok) setOpen(false) }
    el?.addEventListener('foundora-form-result', result)
    return () => el?.removeEventListener('foundora-form-result', result)
  }, [closeOnSave])
  return <div ref={root}><button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>{label}</button><Modal open={open} title={title} onClose={() => setOpen(false)}>{open ? children : null}</Modal></div>
}
