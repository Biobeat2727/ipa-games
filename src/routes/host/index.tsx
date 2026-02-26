import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { generateRoomCode } from '../../lib/roomCode'
import { clearHostSession, getHostId, getRoomCode, setHostId, setRoomCode } from '../../lib/session'
import { getContentSummary, importContent } from '../../lib/content'
import type { ContentJSON, ContentSummary } from '../../lib/content'
import type { Room, Team } from '../../lib/types'
import Game from './Game'

type Phase = 'creating' | 'lobby' | 'game' | 'error'

export default function HostView() {
  const [phase, setPhase]   = useState<Phase>('creating')
  const [room, setRoom]     = useState<Room | null>(null)
  const [teams, setTeams]   = useState<Team[]>([])
  const [error, setError]   = useState('')

  // Ref to the lobby broadcast channel so handleStartGame can fire game_state_change
  const lobbyBroadcastRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Content import state
  const [summary, setSummary]         = useState<ContentSummary | null>(null)
  const [showImport, setShowImport]   = useState(false)
  const [jsonInput, setJsonInput]     = useState('')
  const [importing, setImporting]     = useState(false)
  const [importError, setImportError] = useState('')

  const fetchTeams = useCallback(async (roomId: string) => {
    const { data } = await supabase
      .from('teams').select().eq('room_id', roomId).order('created_at', { ascending: true })
    setTeams(data ?? [])
  }, [])

  const fetchSummary = useCallback(async (roomId: string) => {
    setSummary(await getContentSummary(roomId))
  }, [])

  // On mount: resume existing room or create a new one
  useEffect(() => {
    async function init() {
      const savedCode   = getRoomCode()
      const savedHostId = getHostId()

      if (savedCode && savedHostId) {
        const { data } = await supabase
          .from('rooms').select()
          .eq('code', savedCode).eq('host_id', savedHostId)
          .single()

        if (data) {
          setRoom(data)
          await Promise.all([fetchTeams(data.id), fetchSummary(data.id)])
          setPhase(data.status === 'lobby' ? 'lobby' : 'game')
          return
        }
      }

      await createRoom()
    }

    async function createRoom() {
      const hostId = crypto.randomUUID()
      let code = generateRoomCode()

      for (let attempt = 0; attempt < 10; attempt++) {
        const { data, error: err } = await supabase
          .from('rooms').insert({ code, host_id: hostId, status: 'lobby' }).select().single()

        if (data) {
          setHostId(hostId); setRoomCode(code)
          setRoom(data); setPhase('lobby')
          return
        }
        if (err?.code === '23505') { code = generateRoomCode(); continue }
        setError(err?.message ?? 'Failed to create room.'); setPhase('error'); return
      }

      setError('Could not generate a unique room code.'); setPhase('error')
    }

    init()
  }, [fetchTeams, fetchSummary])

  // Real-time team subscription (lobby only)
  useEffect(() => {
    if (!room?.id || phase !== 'lobby') return

    const roomId = room.id
    const code = room.code

    // postgres_changes fallback (requires teams table in realtime publication)
    const pgCh = supabase
      .channel(`host-lobby-${roomId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${roomId}` },
        () => fetchTeams(roomId))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') fetchTeams(roomId)
      })

    // Broadcast listener — fires immediately when any player creates/joins a team
    const bcCh = supabase
      .channel(`room:${code}`)
      .on('broadcast', { event: 'team_joined' }, () => fetchTeams(roomId))
      .subscribe()

    lobbyBroadcastRef.current = bcCh

    return () => {
      supabase.removeChannel(pgCh)
      supabase.removeChannel(bcCh)
      lobbyBroadcastRef.current = null
    }
  }, [room?.id, room?.code, phase, fetchTeams])

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

  async function handleStartGame() {
    if (!room) return
    const { error: err } = await supabase
      .from('rooms').update({ status: 'round_1' }).eq('id', room.id)
    if (!err) {
      // Broadcast immediately so projector/players don't have to wait for postgres_changes
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
    clearHostSession()
    window.location.reload()
  }

  // ── Screens ───────────────────────────────────────────────

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

  if (phase === 'game' && room) {
    return <Game roomId={room.id} initialRoom={room} teams={teams} />
  }

  // ── Lobby ─────────────────────────────────────────────────
  const canStart = teams.length >= 2 && !!summary

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-xl mx-auto">

        {/* Room code */}
        <div className="text-center mb-8">
          <p className="text-gray-500 text-xs uppercase tracking-widest mb-2">Room Code</p>
          <p className="text-7xl font-mono font-black tracking-widest text-yellow-400 select-all">
            {room?.code}
          </p>
          <p className="text-gray-500 text-sm mt-3">
            Players join at <span className="text-white font-medium">[your-url]/play</span>
          </p>
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
              {teams.map(team => (
                <li key={team.id} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                  <span className="font-medium">{team.name}</span>
                </li>
              ))}
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
