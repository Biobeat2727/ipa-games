import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { RoomBlock } from '../lib/types'

/**
 * The host's list of phones blocked from this game, each with Unblock (for a
 * misclick, or someone who talked their way back in). Renders nothing while the
 * list is empty. `refreshKey` changes whenever the host blocks someone.
 */
export default function BlockedList({
  roomId,
  refreshKey,
  publish,
}: {
  roomId: string
  refreshKey: number
  publish: (event: string, data: unknown) => void
}) {
  const [blocks, setBlocks] = useState<RoomBlock[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('room_blocks').select()
      .eq('room_id', roomId).order('blocked_at', { ascending: false })
    if (data) setBlocks(data)
  }, [roomId])

  useEffect(() => { void load() }, [load, refreshKey])

  async function unblock(block: RoomBlock) {
    setBusy(block.id); setError('')
    const { error: err } = await supabase.rpc('host_unblock', { p_block_id: block.id })
    setBusy(null)
    if (err) { setError(err.message); return }
    publish('player_unblocked', { device_id: block.device_id })
    setBlocks(prev => prev.filter(b => b.id !== block.id))
  }

  if (blocks.length === 0) return null

  return (
    <div className="mt-3 pt-3 border-t border-gray-800 text-xs">
      <p className="text-gray-500 uppercase tracking-wider mb-1">Blocked ({blocks.length})</p>
      <ul className="space-y-1">
        {blocks.map(b => (
          <li key={b.id} className="flex items-center gap-2">
            <span className="flex-1 truncate text-gray-400">
              {b.nickname || 'Unnamed player'}
              {b.team_name && <span className="text-gray-600"> · was on {b.team_name}</span>}
            </span>
            <button
              onClick={() => void unblock(b)}
              disabled={busy != null}
              className="text-gray-500 hover:text-green-400 disabled:opacity-30 transition-colors"
            >{busy === b.id ? '…' : 'Unblock'}</button>
          </li>
        ))}
      </ul>
      {error && <p className="text-red-400 mt-1">{error}</p>}
    </div>
  )
}
