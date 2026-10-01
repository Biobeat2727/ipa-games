import { useEffect, useRef } from 'react'
import { supabase } from './supabase'
import type { Team } from './types'

// A team has to sit at zero players this long before the host removes it. Covers
// the gap between a phone creating a team and its player row landing (a slow join
// retries for several seconds), and a player switching teams mid-request.
export const EMPTY_TEAM_GRACE_MS = 30_000
const SWEEP_INTERVAL_MS = 5_000

/**
 * Host-side cleanup: a team whose last player left (Leave button, or switching to
 * another team) is removed through the same authorized `kick_team` path as the
 * host's ✕, so it doesn't ride through the whole game as a stale row.
 *
 * Only player rows count — a phone that's asleep or closed still has its row, so
 * a team is never removed for being quiet, only for being empty.
 *
 * `blocked` mirrors the moments a kick is refused (live clue, Final Tap review,
 * game over); the sweep just waits and tries again once play is idle.
 * `remove` returns true when the team is gone.
 */
export function useEmptyTeamSweep(opts: {
  enabled: boolean
  teams: Team[]
  blocked: boolean
  remove: (team: Team) => Promise<boolean>
}) {
  const latest = useRef(opts)
  latest.current = opts
  // team id → when the sweep first saw it with zero players
  const emptySinceRef = useRef(new Map<string, number>())
  const busyRef = useRef(false)

  useEffect(() => {
    if (!opts.enabled) return
    const emptySince = emptySinceRef.current
    const sweep = async () => {
      const { teams, blocked, remove } = latest.current
      if (busyRef.current || teams.length === 0) return
      busyRef.current = true
      try {
        const { data, error } = await supabase
          .from('players').select('team_id').in('team_id', teams.map(t => t.id))
        if (error || !data) return // unknown — never treat a failed read as "empty"
        const occupied = new Set(data.map(p => p.team_id as string))
        const now = Date.now()
        for (const id of [...emptySince.keys()]) {
          if (occupied.has(id) || !teams.some(t => t.id === id)) emptySince.delete(id)
        }
        const expired: Team[] = []
        for (const t of teams) {
          if (occupied.has(t.id)) continue
          const since = emptySince.get(t.id)
          if (since === undefined) emptySince.set(t.id, now)
          else if (now - since >= EMPTY_TEAM_GRACE_MS) expired.push(t)
        }
        if (import.meta.env.DEV && expired.length) {
          console.debug('[empty-team sweep]', blocked ? 'waiting (play not idle):' : 'removing:', expired.map(t => t.name).join(', '))
        }
        if (blocked) return
        for (const t of expired) {
          // The roster may have moved on while we awaited (host kicked it by hand)
          if (!latest.current.teams.some(x => x.id === t.id) || latest.current.blocked) break
          if (await remove(t)) emptySince.delete(t.id)
        }
      } finally {
        busyRef.current = false
      }
    }
    const id = setInterval(() => { void sweep() }, SWEEP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [opts.enabled])
}
