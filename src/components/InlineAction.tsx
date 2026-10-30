'use client'

import { startTransition, useActionState, useEffect, useRef } from 'react'
import { initialActionState, type ActionState } from '@/lib/types'

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>
  hidden?: Record<string, string>
  submitLabel: string
  pendingLabel?: string
  variant?: 'primary' | 'secondary' | 'danger'
  confirmText?: string
  /** Shown after success, e.g. "Saved". */
  okText?: string
  /** Empty the fields after success (forms that add something). */
  resetOnOk?: boolean
  className?: string
  children?: React.ReactNode
}

// A compact form bound to a server action: fields and button on one line
// (wrapping on phones), the error underneath. Submitted by hand so typed
// values stay when the server refuses something.
export default function InlineAction({
  action, hidden = {}, submitLabel, pendingLabel, variant = 'secondary', confirmText, okText, resetOnOk, className = '', children,
}: Props) {
  const [state, formAction, pending] = useActionState(action, initialActionState)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (resetOnOk && state.ok) form.current?.reset()
  }, [state, resetOnOk])
  return (
    <form
      ref={form}
      className={className}
      onSubmit={(e) => {
        e.preventDefault()
        if (confirmText && !window.confirm(confirmText)) return
        const data = new FormData(e.currentTarget)
        startTransition(() => formAction(data))
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {children}
        <button type="submit" className={`btn btn-${variant} min-h-10 px-3 text-sm`} disabled={pending}>
          {pending ? pendingLabel ?? '…' : submitLabel}
        </button>
        {okText && state.ok && !state.error && !pending && <span role="status" className="text-sm text-teal">{okText}</span>}
      </div>
      {state.error && (
        <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>
      )}
    </form>
  )
}
