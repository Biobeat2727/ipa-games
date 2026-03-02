import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { generateRoomCode } from '../../lib/roomCode'
import { getContentSummary, importContent } from '../../lib/content'
import type { ContentJSON, ContentSummary } from '../../lib/content'
import type { Room, Team } from '../../lib/types'
import Game from './Game'

type Phase = 'checking' | 'no_room' | 'creating' | 'lobby' | 'game' | 'error'

// Find the most recent active room created today (local midnight cutoff)
async function findActiveRoom(): Promise<Room | null> {
  const todayMidnight = new Date()
  todayMidnight.setHours(0, 0, 0, 0)

  const { data } = await supabase
    .from('rooms')
    .select()
    .neq('status', 'finished')
    .gte('created_at', todayMidnight.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data ?? null
}

export default function HostView() {
  const [phase, setPhase]        = useState<Phase>('checking')
  const [room, setRoom]          = useState<Room | null>(null)
  const [teams, setTeams]        = useState<Team[]>([])
  const [playerCounts, setPlayerCounts] = useState<Map<string, number>>(new Map())
  const [error, setError]        = useState('')

  // Ref to the lobby broadcast channel so handleStartGame can fire game_state_change
  const lobbyBroadcastRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Content import state
  const [summary, setSummary]         = useState<ContentSummary | null>(null)
  const [showImport, setShowImport]   = useState(false)
  const [jsonInput, setJsonInput]     = useState('')
  const [importing, setImporting]     = useState(false)
  const [importError, setImportError] = useState('')

  const fetchTeams = useCallback(async (roomId: string) => {
    const { data: teamData } = await supabase
      .from('teams').select().eq('room_id', roomId).order('created_at', { ascending: true })
    setTeams(teamData ?? [])

    if (teamData?.length) {
      const { data: playerData } = await supabase
        .from('players').select('team_id').in('team_id', teamData.map(t => t.id))
      const counts = new Map<string, number>()
      for (const p of playerData ?? []) {
        counts.set(p.team_id, (counts.get(p.team_id) ?? 0) + 1)
      }
      setPlayerCounts(counts)
    } else {
      setPlayerCounts(new Map())
    }
  }, [])

  const fetchSummary = useCallback(async (roomId: string) => {
    setSummary(await getContentSummary(roomId))
  }, [])

  // On mount: auto-resolve today's active room, or show "Create Lobby" button
  useEffect(() => {
    async function init() {
      const existing = await findActiveRoom()
      if (existing) {
        setRoom(existing)
        await Promise.all([fetchTeams(existing.id), fetchSummary(existing.id)])
        setPhase(existing.status === 'lobby' ? 'lobby' : 'game')
      } else {
        setPhase('no_room')
      }
    }
    init()
  }, [fetchTeams, fetchSummary])

  // Real-time team subscription (lobby only)
  useEffect(() => {
    if (!room?.id || phase !== 'lobby') return

    const roomId = room.id

    // postgres_changes path — requires teams table in Supabase realtime publication
    const pgCh = supabase
      .channel(`host-lobby-${roomId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${roomId}` },
        () => fetchTeams(roomId))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') fetchTeams(roomId)
      })

    // Broadcast path — player sends team_joined after joining
    const bcCh = supabase
      .channel(`room:${roomId}`)
      .on('broadcast', { event: 'team_joined' }, () => fetchTeams(roomId))
      .subscribe()

    lobbyBroadcastRef.current = bcCh

    return () => {
      supabase.removeChannel(pgCh)
      supabase.removeChannel(bcCh)
      lobbyBroadcastRef.current = null
    }
  }, [room?.id, phase, fetchTeams])

  async function handleCreateRoom() {
    setPhase('creating')

    // Retire any lingering active rooms so players always resolve to this new one
    await supabase.from('rooms').update({ status: 'finished' }).neq('status', 'finished')

    const hostId = crypto.randomUUID()
    let code = generateRoomCode()

    for (let attempt = 0; attempt < 10; attempt++) {
      const { data, error: err } = await supabase
        .from('rooms').insert({ code, host_id: hostId, status: 'lobby' }).select().single()

      if (data) {
        setRoom(data)
        setPhase('lobby')
        return
      }
      if (err?.code === '23505') { code = generateRoomCode(); continue }
      setError(err?.message ?? 'Failed to create room.')
      setPhase('error')
      return
    }

    setError('Could not generate a unique room code.')
    setPhase('error')
  }

  async function handleImport() {
    if (!room) return
    setImporting(true); setImportError('')
    try {
      await importContent(room.id, JSON.parse(jsonInput) as ContentJSON)
      await fetchSummary(room.id)
      setJsonInput(''); setShowImport(false)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Invalid JSON')
    } finally {
      setImporting(false)
    }
  }

  async function handleDeleteTeam(teamId: string) {
    await supabase.from('players').delete().eq('team_id', teamId)
    const { error: err } = await supabase.from('teams').delete().eq('id', teamId)
    if (!err) {
      setTeams(prev => prev.filter(t => t.id !== teamId))
      setPlayerCounts(prev => { const m = new Map(prev); m.delete(teamId); return m })
    }
  }

  async function handleStartGame() {
    if (!room) return
    const { error: err } = await supabase
      .from('rooms').update({ status: 'round_1' }).eq('id', room.id)
    if (!err) {
      lobbyBroadcastRef.current?.send({
        type: 'broadcast',
        event: 'game_state_change',
        payload: { status: 'round_1' },
      })
      setRoom(prev => prev ? { ...prev, status: 'round_1' } : prev)
      setPhase('game')
    }
  }

  function handleNewGame() {
    setRoom(null)
    setTeams([])
    setPlayerCounts(new Map())
    setSummary(null)
    setPhase('no_room')
  }

  // ── Screens ───────────────────────────────────────────────

  if (phase === 'checking') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400 text-lg animate-pulse">Checking for active room…</p>
      </div>
    )
  }

  if (phase === 'creating') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400 text-lg animate-pulse">Setting up room…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">{error}</p>
        <button onClick={handleNewGame} className="text-yellow-400 underline text-sm">Try again</button>
      </div>
    )
  }

  if (phase === 'no_room') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-6">
        <h1 className="text-3xl font-black text-yellow-400">Tapped In!</h1>
        <p className="text-gray-500 text-sm">No active lobby found for today.</p>
        <button
          onClick={handleCreateRoom}
          className="px-10 py-4 rounded-2xl text-xl font-black bg-yellow-400 text-gray-950"
        >
          Create Lobby
        </button>
      </div>
    )
  }

  if (phase === 'game' && room) {
    return <Game roomId={room.id} initialRoom={room} teams={teams} />
  }

  // ── Lobby ─────────────────────────────────────────────────
  const canStart = teams.length >= 2 && !!summary

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold text-white">Tapped In! — Host</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Players join at <span className="text-white font-medium">tappedin.lol</span>
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="bg-gray-900 rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-300">
              {summary
                ? `R1: ${summary.round1} cats · R2: ${summary.round2} cats${summary.hasFinalJeopardy ? ' · FJ ✓' : ''}`
                : 'No content loaded'}
            </p>
            <button
              onClick={() => { setShowImport(v => !v); setImportError('') }}
              className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors ml-4 shrink-0"
            >
              {showImport ? 'Cancel' : summary ? 'Replace' : 'Import JSON'}
            </button>
          </div>

          {showImport && (
            <div className="mt-4 space-y-3">
              <textarea
                value={jsonInput}
                onChange={e => setJsonInput(e.target.value)}
                placeholder="Paste your content JSON here…"
                rows={8}
                className="w-full bg-gray-800 text-gray-200 text-xs font-mono rounded-xl p-3 outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
              />
              {importError && <p className="text-red-400 text-xs">{importError}</p>}
              <button
                onClick={handleImport}
                disabled={importing || !jsonInput.trim()}
                className="w-full py-2 rounded-xl text-sm font-bold bg-yellow-400 text-gray-950 disabled:opacity-30"
              >
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          )}
        </div>

        {/* Teams */}
        <div className="bg-gray-900 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-300">Teams</h2>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">
              {teams.length} joined
            </span>
          </div>
          {teams.length === 0 ? (
            <p className="text-gray-600 text-sm">Waiting for teams to join…</p>
          ) : (
            <ul className="space-y-2">
              {teams.map(team => {
                const count = playerCounts.get(team.id) ?? 0
                return (
                  <li key={team.id} className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                    <span className="font-medium flex-1">{team.name}</span>
                    <span className="text-xs text-gray-500">
                      {count} {count === 1 ? 'player' : 'players'}
                    </span>
                    <button
                      onClick={() => handleDeleteTeam(team.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors px-1"
                      title="Remove team"
                    >
                      ✕
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <button
          onClick={handleStartGame}
          disabled={!canStart}
          className="w-full py-4 rounded-2xl text-xl font-black bg-yellow-400 text-gray-950 disabled:opacity-25 disabled:cursor-not-allowed transition-opacity"
        >
          {!summary ? 'Import content to start' : teams.length < 2 ? 'Need 2+ teams' : 'Start Game'}
        </button>

        <button
          onClick={handleNewGame}
          className="mt-4 w-full text-sm text-gray-600 hover:text-gray-400 transition-colors"
        >
          New Game
        </button>
      </div>
    </div>
  )
}
