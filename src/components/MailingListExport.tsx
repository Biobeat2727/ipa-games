import { useEffect, useState } from 'react'
import { downloadMailingListCsv, mailingListCount } from '../lib/mailingList'

/** Host lobby / game-over: sign-up count + "Download CSV" for the Tapped In!
 *  mailing list. Shows a setup hint if the table isn't there yet. */
export default function MailingListExport({ className = '' }: { className?: string }) {
  const [count, setCount] = useState<number | null | undefined>(undefined) // undefined = loading, null = unavailable
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let alive = true
    void mailingListCount().then(c => { if (alive) setCount(c) })
    return () => { alive = false }
  }, [])

  async function handleDownload() {
    setBusy(true)
    setMessage('')
    try {
      const n = await downloadMailingListCsv()
      setCount(n)
      setMessage(n === 0 ? 'No sign-ups yet.' : `Downloaded ${n} address${n === 1 ? '' : 'es'}.`)
    } catch (err) {
      setMessage(`Couldn't download: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`w-full rounded-xl bg-gray-900 border border-gray-800 px-4 py-3 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-300">
          📬 Mailing list
          <span className="text-gray-500">
            {count === undefined ? ' · …' : count === null ? ' · not set up' : ` · ${count} sign-up${count === 1 ? '' : 's'}`}
          </span>
        </p>
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={busy || count === null}
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold bg-gray-800 text-yellow-400 hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {busy ? 'Preparing…' : 'Download CSV'}
        </button>
      </div>
      {count === null && (
        <p className="text-xs text-gray-600 mt-1">Run supabase/add_mailing_list.sql to turn on sign-ups.</p>
      )}
      {message && <p className="text-xs text-gray-500 mt-1">{message}</p>}
    </div>
  )
}
