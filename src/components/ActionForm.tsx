'use client'

import { useActionState } from 'react'
import { initialActionState, type ActionState } from '@/lib/types'

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>
  hidden?: Record<string, string>
  submitLabel: string
  pendingLabel?: string
  variant?: 'primary' | 'secondary' | 'danger'
  confirmText?: string
  className?: string
  children?: React.ReactNode
}

// A form bound to a server action, showing the action's error inline.
export default function ActionForm({
  action,
  hidden = {},
  submitLabel,
  pendingLabel,
  variant = 'primary',
  confirmText,
  className = '',
  children,
}: Props) {
  const [state, formAction, pending] = useActionState(action, initialActionState)

  return (
    <form
      action={formAction}
      className={`space-y-3 ${className}`}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault()
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" className={`btn btn-${variant} w-full sm:w-auto`} disabled={pending}>
        {pending ? pendingLabel ?? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
