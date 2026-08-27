import { useState } from 'react'
import { supabase } from '../lib/supabase'

const MAX_LEN = 2000

/** Post-game feedback box on the player results screen: thoughts or bug reports
 *  go straight to the `feedback` table (supabase/add_feedback.sql), which only
 *  the host can read. Collapsed until tapped so it never competes with the
 *  podium, and it disappears entirely once sent. */
export default function FeedbackForm({
  roomId,
  teamId,
  teamName,
}: {
  roomId?: string | null
  teamId?: string | null
  teamName?: string | null
}) {
  const [open, setOpen]       = useState(false)
  const [kind, setKind]       = useState<'thoughts' | 'bug'>('thoughts')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')

  async function handleSend() {
    const body = message.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    const { error: insertError } = await supabase.from('feedback').insert({
      room_id: roomId ?? null,
      team_id: teamId ?? null,
      team_name: teamName ?? null,
      kind,
      message: body.slice(0, MAX_LEN),
    })
    setSending(false)
    if (insertError) {
      setError("Couldn't send that — check your connection and try again.")
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="w-full max-w-xs glass-card rounded-2xl px-4 py-4 text-center"
        style={{ animation: 'pop-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
        <p className="text-2xl mb-1">🍻</p>
        <p className="font-black text-amber-300">Thanks — got it!</p>
        <p className="text-gray-500 text-xs mt-1">Davey reads every one of these.</p>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full max-w-xs glass-card rounded-2xl px-4 py-3 text-center active:scale-[0.99] transition-transform"
      >
        <p className="font-black text-amber-300">💬 Send feedback</p>
        <p className="text-gray-500 text-xs mt-0.5">Thoughts or a bug? Tell the host</p>
      </button>
    )
  }

  return (
    <div className="w-full max-w-xs glass-card rounded-2xl px-4 py-4 text-left">
      <div className="flex gap-2 mb-3">
        {([['thoughts', '💬 Thoughts'], ['bug', '🐞 Bug']] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setKind(value)}
            className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
              kind === value ? 'bg-amber-400 text-amber-950' : 'bg-white/5 text-gray-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        autoFocus
        rows={3}
        maxLength={MAX_LEN}
        placeholder={kind === 'bug' ? 'What went wrong?' : 'How was trivia tonight?'}
        value={message}
        onChange={e => { setMessage(e.target.value); if (error) setError('') }}
        className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-gray-600 resize-none text-base mb-3"
      />
      {error && <p role="alert" className="text-red-400 text-xs mb-2">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => { setOpen(false); setError('') }}
          className="px-3 py-2.5 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-300 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSend}
          disabled={!message.trim() || sending}
          className="btn-beer flex-1 py-2.5 rounded-xl font-black text-sm"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
