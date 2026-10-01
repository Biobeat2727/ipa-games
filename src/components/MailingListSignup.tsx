import { useState } from 'react'
import { joinMailingList, looksLikeEmail, MAILING_LIST_JOINED_KEY } from '../lib/mailingList'

/** End-of-game opt-in for the Tapped In! mailing list (player results screen).
 *  Remembers a sign-up on this phone so returning players see a quiet
 *  "you're on the list" instead of being asked every week. */
export default function MailingListSignup({
  roomId,
  teamName,
  style,
}: {
  roomId?: string | null
  teamName?: string | null
  style?: React.CSSProperties
}) {
  const [joined, setJoined] = useState(() => {
    try { return localStorage.getItem(MAILING_LIST_JOINED_KEY) === '1' } catch { return false }
  })
  const [justJoined, setJustJoined] = useState(false)
  const [email, setEmail]   = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError]   = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (sending) return
    if (!looksLikeEmail(email)) {
      setError("That doesn't look like an email address.")
      return
    }
    setSending(true)
    setError('')
    const { error: rpcError } = await joinMailingList(email, roomId, teamName)
    setSending(false)
    if (rpcError) {
      setError(rpcError.code === '22023'
        ? "That doesn't look like an email address."
        : "Couldn't sign you up — check your connection and try again.")
      return
    }
    try { localStorage.setItem(MAILING_LIST_JOINED_KEY, '1') } catch { /* private mode */ }
    setJoined(true)
    setJustJoined(true)
  }

  if (joined) {
    return (
      <div className="w-full max-w-xs glass-card rounded-2xl px-4 py-3 text-center" style={style}>
        <p className="font-black text-amber-300">{justJoined ? "📬 You're on the list!" : '📬 On the Tapped In! list'}</p>
        <p className="text-gray-500 text-xs mt-0.5">
          {justJoined ? "We'll let you know about the next trivia night." : 'See you at the next trivia night.'}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate
      className="w-full max-w-xs glass-card rounded-2xl px-4 py-3 text-left" style={style}>
      <p className="font-black text-amber-300 text-center text-sm mb-2">📬 Get the next trivia night by email</p>
      <div className="flex gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          placeholder="you@email.com"
          aria-label="Email address"
          value={email}
          onChange={e => { setEmail(e.target.value); if (error) setError('') }}
          maxLength={254}
          className="min-w-0 flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-base text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-400/60"
        />
        <button
          type="submit"
          disabled={sending || !email.trim()}
          className="shrink-0 rounded-xl px-4 py-2 text-sm font-black bg-amber-400 text-amber-950 disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {sending ? '…' : 'Join'}
        </button>
      </div>
      {error && <p role="alert" className="text-red-400 text-xs mt-2">{error}</p>}
      <p className="text-gray-600 text-[11px] mt-1.5 text-center">Tapped In! trivia news only. Ask the host anytime to be taken off.</p>
    </form>
  )
}
