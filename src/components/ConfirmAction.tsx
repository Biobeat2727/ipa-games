import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Host-screen guard for one-way "skip ahead" actions (end a round early, skip
 * the category intros, end the game). The first tap swaps the button for an
 * "Are you sure?" row with Yes / Cancel in the same spot, so an accidental tap
 * does nothing; the prompt quietly backs out after a few seconds untouched.
 */
export default function ConfirmAction({
  children,
  prompt = 'Are you sure?',
  confirmLabel = 'Yes',
  onConfirm,
  className,
  disabled,
  title,
}: {
  children: ReactNode
  prompt?: string
  confirmLabel?: string
  onConfirm: () => void
  className?: string
  disabled?: boolean
  title?: string
}) {
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!asking) return
    const t = setTimeout(() => setAsking(false), 6000)
    return () => clearTimeout(t)
  }, [asking])

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} disabled={disabled} className={className} title={title}>
        {children}
      </button>
    )
  }
  return (
    <div role="group" aria-label={prompt}
      className="w-full flex items-center justify-center gap-3 rounded-xl border border-yellow-500/40 bg-yellow-950/30 px-4 py-3">
      <span className="text-sm font-semibold text-yellow-200">{prompt}</span>
      <button
        type="button"
        autoFocus
        onClick={() => { setAsking(false); onConfirm() }}
        className="px-4 py-1.5 rounded-lg text-sm font-black bg-yellow-400 text-gray-950 hover:bg-yellow-300 transition-colors"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-400 hover:text-white transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}
