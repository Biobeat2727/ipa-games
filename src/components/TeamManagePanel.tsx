import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Team } from '../lib/types'

type Publish = (event: string, data: unknown) => void

type Seat = { id: string; nickname: string | null; session_id: string; created_at: string }

/**
 * Host moderation for one team (lobby list and in-game scoreboard). Opened by
 * tapping the team name; sits under the team's row.
 *
 *  - Rename the team (any time).
 *  - Each player: Remove (off the team, can rejoin) or Block (out for the rest of
 *    this game). Both follow kick_team's timing rules — `blockedReason` greys them
 *    out at the same moments the ✕ is greyed.
 *  - Block team: the parent's kick flow with blocking (onBlockTeam).
 *
 * Phones are told over the room channel (`publish`); the database functions in
 * supabase/phase_b_moderation.sql are what actually enforce it.
 */
export default function TeamManagePanel({
  team,
  blockedReason,
  publish,
  onRenamed,
  onBlockTeam,
  onBlocksChanged,
}: {
  team: Team
  blockedReason: string | null
  publish: Publish
  onRenamed: (team: Team) => void
  onBlockTeam: () => Promise<void>
  onBlocksChanged: () => void
}) {
  const [seats, setSeats] = useState<Seat[] | null>(null)
  const [name, setName] = useState(team.name)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'block' | 'block-team'; id: string } | null>(null)
  const [error, setError] = useState('')

  const loadSeats = useCallback(async () => {
    const { data } = await supabase.from('players')
      .select('id, nickname, session_id, created_at')
      .eq('team_id', team.id).order('created_at', { ascending: true })
    if (data) setSeats(data)
  }, [team.id])

  // Fresh roster on open, then a light poll while it stays open (joins/leaves)
  useEffect(() => {
    void loadSeats()
    const id = setInterval(() => { void loadSeats() }, 4000)
    return () => clearInterval(id)
  }, [loadSeats])

  useEffect(() => { setName(team.name) }, [team.name])

  // A confirm row backs out by itself if left untouched (same as ConfirmAction)
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(null), 6000)
    return () => clearTimeout(t)
  }, [confirm])

  async function removeSeat(seat: Seat, block: boolean) {
    setConfirm(null); setBusy(seat.id); setError('')
    const { data, error: err } = block
      ? await supabase.rpc('host_block_player', { p_player_id: seat.id })
      : await supabase.rpc('host_remove_player', { p_player_id: seat.id })
    setBusy(null)
    if (err) { setError(err.message); return }
    const deviceId = data?.[0]?.device_id ?? seat.session_id
    if (block) {
      publish('player_blocked', { device_ids: [deviceId], team_id: team.id, team_name: team.name })
      onBlocksChanged()
    } else {
      publish('player_removed', { device_id: deviceId, team_id: team.id, team_name: team.name })
    }
    void loadSeats()
  }

  async function rename() {
    const next = name.trim()
    if (!next || next === team.name) return
    setBusy('rename'); setError('')
    const { data, error: err } = await supabase.rpc('host_rename_team', { p_team_id: team.id, p_name: next }).single()
    setBusy(null)
    if (err || !data) { setError(err?.message ?? 'Rename failed'); return }
    publish('team_renamed', { team_id: team.id, name: data.name })
    onRenamed(data)
  }

  async function blockTeam() {
    setConfirm(null); setBusy('block-team'); setError('')
    await onBlockTeam()
    setBusy(null)
  }

  const rosterLocked = blockedReason != null || busy != null

  return (
    <div className="mt-1 mb-2 ml-6 rounded-lg border border-gray-800 bg-gray-950/60 p-2 space-y-2 text-xs">
      <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); void rename() }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={40}
          aria-label={`New name for ${team.name}`}
          className="flex-1 min-w-0 bg-gray-800 rounded px-2 py-1 text-gray-100 outline-none focus:ring-1 focus:ring-yellow-400"
        />
        <button
          type="submit"
          disabled={busy != null || !name.trim() || name.trim() === team.name}
          className="px-2 py-1 rounded bg-gray-800 text-gray-300 hover:text-yellow-300 disabled:opacity-30 transition-colors"
        >
          {busy === 'rename' ? '…' : 'Rename'}
        </button>
      </form>

      <div>
        <p className="text-gray-500 uppercase tracking-wider mb-1">Players</p>
        {seats === null ? (
          <p className="text-gray-600">Loading…</p>
        ) : seats.length === 0 ? (
          <p className="text-gray-600">Nobody on this team right now</p>
        ) : (
          <ul className="space-y-1">
            {seats.map(seat => (
              <li key={seat.id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-gray-300">{seat.nickname || 'Unnamed player'}</span>
                {confirm?.id === seat.id ? (
                  <>
                    <span className="text-red-300">
                      {confirm.kind === 'block' ? 'Block for the rest of the game?' : 'Remove from team?'}
                    </span>
                    <button onClick={() => void removeSeat(seat, confirm.kind === 'block')}
                      className="text-red-400 hover:text-red-300 font-semibold">Yes</button>
                    <button onClick={() => setConfirm(null)} className="text-gray-600 hover:text-gray-400">Cancel</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setConfirm({ kind: 'remove', id: seat.id })}
                      disabled={rosterLocked}
                      title={blockedReason ?? 'Take them off this team — they can join again'}
                      className="text-gray-500 hover:text-yellow-300 disabled:opacity-30 transition-colors"
                    >{busy === seat.id ? '…' : 'Remove'}</button>
                    <button
                      onClick={() => setConfirm({ kind: 'block', id: seat.id })}
                      disabled={rosterLocked}
                      title={blockedReason ?? 'Remove them and keep them out for the rest of this game'}
                      className="text-gray-500 hover:text-red-400 disabled:opacity-30 transition-colors"
                    >Block</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-gray-800">
        {confirm?.kind === 'block-team' ? (
          <>
            <span className="text-red-300">Remove {team.name} and block everyone on it?</span>
            <button onClick={() => void blockTeam()} className="text-red-400 hover:text-red-300 font-semibold">Yes</button>
            <button onClick={() => setConfirm(null)} className="text-gray-600 hover:text-gray-400">Cancel</button>
          </>
        ) : (
          <button
            onClick={() => setConfirm({ kind: 'block-team', id: team.id })}
            disabled={rosterLocked}
            title={blockedReason ?? 'Remove the team and keep every phone on it out for the rest of this game'}
            className="text-gray-500 hover:text-red-400 disabled:opacity-30 transition-colors"
          >{busy === 'block-team' ? '…' : 'Block team'}</button>
        )}
      </div>

      {blockedReason && <p className="text-gray-600">{blockedReason}</p>}
      {error && <p className="text-red-400">{error}</p>}
    </div>
  )
}
