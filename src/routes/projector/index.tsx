import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Buzz, Question, Room, Team } from '../../lib/types'

interface TimerPayload {
  start_timestamp: number
  duration_seconds: number
  team_id: string
  buzz_id: string
  team_name: string
}

type CategoryRow = {
  id: string
  name: string
  questions: Question[]
}

export default function ProjectorView() {
  const [codeInput, setCodeInput]       = useState('')
  const [room, setRoom]                 = useState<Room | null>(null)
  const [teams, setTeams]               = useState<Team[]>([])
  const [categories, setCategories]     = useState<CategoryRow[]>([])
  const [buzzes, setBuzzes]             = useState<Buzz[]>([])
  const [timerPayload, setTimerPayload] = useState<TimerPayload | null>(null)
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [scores, setScores]             = useState<Map<string, number>>(new Map())
  const [feedbackTeam, setFeedbackTeam]           = useState<string | null>(null)
  const [currentTurnTeamId, setCurrentTurnTeamId] = useState<string | null>(null)
  const [previewInfo, setPreviewInfo]             = useState<{
    questionId: string; categoryName: string; pointValue: number | null; startTs: number
  } | null>(null)
  const [previewCountdown, setPreviewCountdown]   = useState<number | null>(null)
  const [error, setError]               = useState('')

  // Refs — give stable callbacks access to latest values without re-creating them
  const roomRef            = useRef<Room | null>(null)
  const teamsRef           = useRef<Team[]>([])
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { roomRef.current = room },   [room])
  useEffect(() => { teamsRef.current = teams }, [teams])

  // ── Stable data helpers ───────────────────────────────────
  // These use roomRef so they never go stale inside effect closures.

  const loadCategories = useCallback(async (roomId: string, status: string) => {
    const { data: cats } = await supabase
      .from('categories').select('id, name, round')
      .eq('room_id', roomId).order('round').order('name')
    if (!cats) return

    const targetRound = status === 'round_2' ? 2 : 1
    const roundCats   = cats.filter(c => c.round === targetRound)
    if (roundCats.length === 0) { setCategories([]); return }

    const { data: questions } = await supabase
      .from('questions').select().in('category_id', roundCats.map(c => c.id))

    setCategories(roundCats.map(cat => ({
      ...cat,
      questions: (questions ?? [])
        .filter(q => q.category_id === cat.id)
        .sort((a, b) => (a.point_value ?? 0) - (b.point_value ?? 0)),
    })))
  }, [])

  const refetchTeams = useCallback(async () => {
    const roomId = roomRef.current?.id
    if (!roomId) return
    const { data } = await supabase
      .from('teams').select().eq('room_id', roomId).order('score', { ascending: false })
    const list = data ?? []
    setTeams(list)
    setScores(new Map(list.map(t => [t.id, t.score])))
  }, [])

  const resyncAll = useCallback(async () => {
    const roomId = roomRef.current?.id
    if (!roomId) return
    const { data: freshRoom } = await supabase.from('rooms').select().eq('id', roomId).single()
    if (!freshRoom) return
    setRoom(freshRoom)
    const { data } = await supabase
      .from('teams').select().eq('room_id', roomId).order('score', { ascending: false })
    const list = data ?? []
    setTeams(list)
    setScores(new Map(list.map(t => [t.id, t.score])))
    if (['round_1', 'round_2'].includes(freshRoom.status)) {
      await loadCategories(roomId, freshRoom.status)
    }
  }, [loadCategories])

  // ── Connect ───────────────────────────────────────────────

  async function handleConnect() {
    const code = codeInput.trim().toUpperCase()
    if (code.length !== 6) return
    setError('')

    const { data: roomData, error: err } = await supabase
      .from('rooms').select().eq('code', code).single()
    if (!roomData || err) { setError('Room not found.'); return }

    const { data: teamData } = await supabase
      .from('teams').select().eq('room_id', roomData.id).order('score', { ascending: false })
    const list = teamData ?? []

    setRoom(roomData)
    setTeams(list)
    setScores(new Map(list.map(t => [t.id, t.score])))

    if (['round_1', 'round_2'].includes(roomData.status)) {
      await loadCategories(roomData.id, roomData.status)
    }
  }

  // ── DB Subscriptions ─────────────────────────────────────

  useEffect(() => {
    if (!room?.id) return
    const roomId = room.id

    const ch = supabase.channel(`projector-db-${roomId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        async payload => {
          const updated = payload.new as Room
          setRoom(updated)
          if (['round_1', 'round_2'].includes(updated.status)) {
            await loadCategories(roomId, updated.status)
          }
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${roomId}` },
        refetchTeams)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'questions' },
        payload => {
          const q = payload.new as Question
          if (q.is_answered && q.answered_by_team_id) {
            const name = teamsRef.current.find(t => t.id === q.answered_by_team_id)?.name ?? ''
            if (name) {
              setFeedbackTeam(name)
              if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
              feedbackTimeoutRef.current = setTimeout(() => setFeedbackTeam(null), 2500)
            }
          }
          // Guard: if this question is answered, clear it as the active question even if
          // the rooms row hasn't propagated yet.
          if (q.is_answered) {
            setRoom(prev => prev?.current_question_id === q.id
              ? { ...prev, current_question_id: null }
              : prev)
          }
          setCategories(prev => prev.map(cat => ({
            ...cat,
            questions: cat.questions.map(old => old.id === q.id ? q : old),
          })))
        })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') resyncAll()
      })

    return () => { supabase.removeChannel(ch) }
  }, [room?.id, loadCategories, refetchTeams, resyncAll])

  // ── Broadcast channel ─────────────────────────────────────

  useEffect(() => {
    if (!room?.code) return
    const ch = supabase.channel(`room:${room.code}`)
      .on('broadcast', { event: 'question_preview' }, ({ payload }) => {
        const p = payload as { questionId: string; categoryName: string; pointValue: number | null; startTs: number }
        setPreviewInfo(p)
      })
      .on('broadcast', { event: 'question_activated' }, ({ payload }) => {
        const { question_id } = payload as { question_id: string }
        setPreviewInfo(null)
        setRoom(prev => prev ? { ...prev, current_question_id: question_id } : prev)
        setTimerPayload(null)
      })
      .on('broadcast', { event: 'question_deactivated' }, () => {
        setRoom(prev => prev ? { ...prev, current_question_id: null } : prev)
        setTimerPayload(null)
      })
      .on('broadcast', { event: 'timer_start' }, ({ payload }) => {
        setTimerPayload(payload as TimerPayload)
      })
      .on('broadcast', { event: 'score_update' }, ({ payload }) => {
        const data = payload as { teams: Array<{ id: string; score: number }>; current_question_id?: string | null }
        setScores(new Map(data.teams.map(t => [t.id, t.score])))
        // If the host embedded current_question_id in the payload, apply it immediately.
        // This is the most reliable path since score_update always arrives.
        if ('current_question_id' in data) {
          setRoom(prev => prev ? { ...prev, current_question_id: data.current_question_id ?? null } : prev)
          if (!data.current_question_id) setTimerPayload(null)
        }
      })
      .on('broadcast', { event: 'turn_change' }, ({ payload }) => {
        const { team_id } = payload as { team_id: string | null }
        setCurrentTurnTeamId(team_id)
      })
      // Fired by players when they join — keeps lobby team list in sync
      .on('broadcast', { event: 'team_joined' }, () => refetchTeams())
      .subscribe(status => {
        // On (re)connect, re-sync all state so nothing is missed
        if (status === 'SUBSCRIBED') resyncAll()
      })
    return () => { supabase.removeChannel(ch) }
  }, [room?.code, refetchTeams, resyncAll])

  // ── Buzzes for active question ────────────────────────────

  useEffect(() => {
    const qId = room?.current_question_id
    if (!qId) { setBuzzes([]); setTimerPayload(null); return }

    const fetch = async () => {
      const { data } = await supabase
        .from('buzzes').select().eq('question_id', qId).order('buzzed_at', { ascending: true })
      setBuzzes(data ?? [])
    }
    fetch()

    const ch = supabase.channel(`projector-buzzes-${qId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'buzzes', filter: `question_id=eq.${qId}` },
        fetch)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [room?.current_question_id])

  // ── Timer countdown ───────────────────────────────────────

  useEffect(() => {
    if (!timerPayload) { setTimeRemaining(null); return }
    const tick = () => {
      const remaining = Math.max(0, Math.floor(
        (timerPayload.start_timestamp + timerPayload.duration_seconds * 1000 - Date.now()) / 1000
      ))
      setTimeRemaining(remaining)
      if (remaining === 0) clearInterval(id)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [timerPayload])

  // ── Preview countdown ─────────────────────────────────────

  useEffect(() => {
    if (!previewInfo) { setPreviewCountdown(null); return }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((previewInfo.startTs + 10_000 - Date.now()) / 1000))
      setPreviewCountdown(remaining)
      if (remaining === 0) clearInterval(id)
    }
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [previewInfo])

  // ── Cleanup ───────────────────────────────────────────────

  useEffect(() => () => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
  }, [])

  // ── Derived ───────────────────────────────────────────────

  // Guard against stale room.current_question_id: if the question is already marked
  // answered in local state, treat it as inactive even if the room row hasn't caught up.
  const activeQuestion = categories.flatMap(c => c.questions)
    .find(q => q.id === room?.current_question_id && !q.is_answered) ?? null

  const sortedTeams   = [...teams].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
  const pendingBuzzes = buzzes.filter(b => b.status === 'pending')
  const pointValues   = [...new Set(
    categories.flatMap(c => c.questions.map(q => q.point_value ?? 0)).filter(Boolean)
  )].sort((a, b) => a - b)

  const teamName = (teamId: string) => teams.find(t => t.id === teamId)?.name ?? '?'

  // ── Screens ───────────────────────────────────────────────

  if (!room) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8">
        <h1 className="text-4xl font-black text-yellow-400 mb-2">Projector</h1>
        <p className="text-gray-500 mb-10 text-sm">Enter the room code to connect</p>
        <div className="w-full max-w-xs space-y-4">
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="XXXXXX"
            maxLength={6}
            value={codeInput}
            onChange={e => setCodeInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleConnect()}
            className="w-full bg-gray-800 text-white text-center text-4xl font-mono tracking-[0.3em] uppercase rounded-2xl px-4 py-5 outline-none focus:ring-2 focus:ring-yellow-400"
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            onClick={handleConnect}
            disabled={codeInput.length !== 6}
            className="w-full py-4 rounded-2xl font-black text-lg bg-yellow-400 text-gray-950 disabled:opacity-30"
          >
            Connect
          </button>
        </div>
      </div>
    )
  }

  // Correct feedback flash
  if (feedbackTeam) {
    return (
      <div className="min-h-screen bg-green-900 text-white flex flex-col items-center justify-center text-center p-8">
        <p className="font-black text-green-300 leading-none mb-6" style={{ fontSize: 'min(20vw, 16rem)' }}>✓</p>
        <p className="font-black text-green-200 mb-4" style={{ fontSize: 'clamp(3rem, 8vw, 7rem)' }}>Correct!</p>
        <p className="font-bold text-white" style={{ fontSize: 'clamp(2rem, 6vw, 5rem)' }}>{feedbackTeam}</p>
      </div>
    )
  }

  // Lobby
  if (room.status === 'lobby') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8 text-center">
        <p className="text-gray-500 uppercase tracking-[0.4em] mb-4" style={{ fontSize: 'clamp(1rem, 2.5vw, 1.75rem)' }}>
          Join the game
        </p>
        <p className="font-mono font-black text-yellow-400 leading-none tracking-widest mb-6"
          style={{ fontSize: 'clamp(5rem, 22vw, 16rem)' }}>
          {room.code}
        </p>
        <p className="text-gray-500 mb-12" style={{ fontSize: 'clamp(0.9rem, 2.5vw, 1.75rem)' }}>
          Open <span className="text-white font-semibold">[your-url]/play</span> on your phone
        </p>
        {sortedTeams.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-4 max-w-5xl">
            {sortedTeams.map(team => (
              <div key={team.id} className="bg-gray-900 border border-gray-800 rounded-2xl px-8 py-4 flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-green-400 shrink-0" />
                <p className="font-bold" style={{ fontSize: 'clamp(1rem, 2.5vw, 2rem)' }}>{team.name}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-700" style={{ fontSize: 'clamp(1rem, 2.5vw, 1.75rem)' }}>
            Waiting for teams to join…
          </p>
        )}
      </div>
    )
  }

  // Game over
  if (room.status === 'finished') {
    const winner = sortedTeams[0]
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8 text-center">
        <p className="text-gray-500 uppercase tracking-widest mb-4" style={{ fontSize: 'clamp(1.25rem, 3vw, 2.5rem)' }}>
          Winner
        </p>
        <p className="font-black text-yellow-400 leading-none mb-10"
          style={{ fontSize: 'clamp(3.5rem, 14vw, 10rem)' }}>
          {winner?.name ?? '—'}
        </p>
        <div className="space-y-3 w-full max-w-2xl">
          {sortedTeams.map((team, i) => (
            <div key={team.id} className="flex items-center gap-4 bg-gray-900 border border-gray-800 rounded-2xl px-8 py-5">
              <span className="text-gray-600 font-mono w-10 shrink-0 text-right"
                style={{ fontSize: 'clamp(1.25rem, 3vw, 2rem)' }}>
                {i + 1}
              </span>
              <span className="font-bold flex-1 text-left" style={{ fontSize: 'clamp(1.25rem, 3vw, 2rem)' }}>
                {team.name}
              </span>
              <span className={`font-mono font-black tabular-nums ${
                (scores.get(team.id) ?? team.score) < 0 ? 'text-red-400' : 'text-yellow-400'
              }`} style={{ fontSize: 'clamp(1.25rem, 3vw, 2rem)' }}>
                {scores.get(team.id) ?? team.score}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Category preview (player selected, countdown before buzz opens)
  if (previewInfo && !activeQuestion) {
    const cnt = previewCountdown ?? 10
    return (
      <div className="h-screen bg-blue-950 text-white flex flex-col items-center justify-center text-center p-8">
        <p className="text-blue-400 uppercase tracking-[0.3em] mb-8"
          style={{ fontSize: 'clamp(1rem, 2.5vw, 2rem)' }}>
          Category
        </p>
        <p className="font-black text-white leading-none mb-6"
          style={{ fontSize: 'clamp(3rem, 10vw, 8rem)' }}>
          {previewInfo.categoryName}
        </p>
        {previewInfo.pointValue != null && (
          <p className="text-yellow-400 font-mono font-black mb-12"
            style={{ fontSize: 'clamp(2rem, 6vw, 5rem)' }}>
            ${previewInfo.pointValue}
          </p>
        )}
        <p className={`font-mono font-black tabular-nums leading-none animate-pulse ${
          cnt <= 3 ? 'text-red-400' : 'text-yellow-300'
        }`} style={{ fontSize: 'clamp(6rem, 18vw, 14rem)' }}>
          {cnt}
        </p>
      </div>
    )
  }

  // Category grid (no active question)
  if (!activeQuestion && categories.length > 0) {
    const roundLabel = room.status === 'round_2' ? 'Round 2' : 'Round 1'
    return (
      <div className="h-screen bg-blue-950 text-white flex flex-col overflow-hidden p-3 gap-2">
        {/* Score bar */}
        <div className="flex items-center justify-between shrink-0 px-3 py-1">
          <div>
            <p className="text-yellow-400 font-mono font-bold uppercase tracking-widest"
              style={{ fontSize: 'clamp(0.9rem, 2vw, 1.25rem)' }}>
              {roundLabel}
            </p>
            {currentTurnTeamId && (
              <p className="text-gray-400 leading-tight" style={{ fontSize: 'clamp(0.7rem, 1.5vw, 1rem)' }}>
                <span className="text-white font-bold">{teamName(currentTurnTeamId)}</span>'s pick
              </p>
            )}
          </div>
          <div className="flex gap-8">
            {sortedTeams.map(team => (
              <div key={team.id} className="text-center">
                <p className="text-gray-400 leading-tight" style={{ fontSize: 'clamp(0.7rem, 1.5vw, 1rem)' }}>
                  {team.name}
                </p>
                <p className={`font-mono font-black tabular-nums ${
                  (scores.get(team.id) ?? 0) < 0 ? 'text-red-400' : 'text-yellow-300'
                }`} style={{ fontSize: 'clamp(1rem, 2.5vw, 1.75rem)' }}>
                  {scores.get(team.id) ?? team.score}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Jeopardy grid */}
        <div
          className="flex-1 grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${categories.length}, 1fr)`,
            gridTemplateRows: `auto repeat(${pointValues.length}, 1fr)`,
          }}
        >
          {/* Category headers */}
          {categories.map(cat => (
            <div key={cat.id}
              className="bg-blue-900 border-2 border-blue-700 rounded-xl flex items-center justify-center p-3 text-center"
            >
              <p className="font-black uppercase tracking-wide leading-tight"
                style={{ fontSize: 'clamp(0.75rem, 1.8vw, 1.4rem)' }}>
                {cat.name}
              </p>
            </div>
          ))}
          {/* Value cells */}
          {pointValues.map(pv =>
            categories.map(cat => {
              const q        = cat.questions.find(q => q.point_value === pv)
              const answered = q?.is_answered ?? false
              return (
                <div key={`${cat.id}-${pv}`}
                  className={`rounded-xl flex items-center justify-center ${
                    answered ? 'bg-blue-950/40' : 'bg-blue-800 border-2 border-blue-600'
                  }`}
                >
                  {!answered && (
                    <p className="font-black text-yellow-400 font-mono tabular-nums"
                      style={{ fontSize: 'clamp(1.25rem, 3.5vw, 3rem)' }}>
                      {pv}
                    </p>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  // Active question
  if (activeQuestion) {
    const dur       = timerPayload?.duration_seconds ?? 30
    const remaining = timeRemaining ?? dur
    const timerPct  = (remaining / dur) * 100
    const timerLow  = remaining <= 10
    const isJudging = !!timerPayload

    return (
      <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
        {/* Timer bar */}
        <div className="h-3 bg-gray-900 w-full shrink-0">
          {isJudging && (
            <div
              className={`h-full transition-all duration-500 ${timerLow ? 'bg-red-500' : 'bg-yellow-400'}`}
              style={{ width: `${timerPct}%` }}
            />
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center px-16 text-center">
          <p className="font-black leading-tight mb-12 max-w-6xl"
            style={{ fontSize: 'clamp(2rem, 5.5vw, 5rem)' }}>
            {activeQuestion.answer}
          </p>

          {isJudging ? (
            <div className="space-y-2 text-center">
              <p className="text-gray-500 uppercase tracking-widest"
                style={{ fontSize: 'clamp(1rem, 2.5vw, 2rem)' }}>
                Responding
              </p>
              <p className="font-black text-yellow-400 leading-tight"
                style={{ fontSize: 'clamp(3rem, 7vw, 6rem)' }}>
                {timerPayload!.team_name}
              </p>
              <p className={`font-mono font-black tabular-nums leading-none ${timerLow ? 'text-red-400' : 'text-gray-300'}`}
                style={{ fontSize: 'clamp(4rem, 12vw, 9rem)' }}>
                {remaining}
              </p>
            </div>
          ) : pendingBuzzes.length > 0 ? (
            <div className="w-full max-w-lg space-y-3">
              <p className="text-gray-500 uppercase tracking-widest mb-4"
                style={{ fontSize: 'clamp(0.8rem, 2vw, 1.5rem)' }}>
                Buzz Queue
              </p>
              {pendingBuzzes.slice(0, 5).map((buzz, i) => (
                <div key={buzz.id}
                  className={`flex items-center gap-5 rounded-2xl px-8 py-4 ${
                    i === 0
                      ? 'bg-yellow-400/20 border-2 border-yellow-400/60'
                      : 'bg-gray-900 border border-gray-800'
                  }`}
                >
                  <span className="font-mono text-gray-600 w-6 shrink-0"
                    style={{ fontSize: 'clamp(1rem, 2vw, 1.5rem)' }}>
                    {i + 1}
                  </span>
                  <span className={`font-black flex-1 text-left ${i === 0 ? 'text-yellow-400' : 'text-white'}`}
                    style={{ fontSize: 'clamp(1.25rem, 3vw, 2.5rem)' }}>
                    {teamName(buzz.team_id)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-700" style={{ fontSize: 'clamp(1.25rem, 3vw, 2.5rem)' }}>
              Waiting for buzzes…
            </p>
          )}
        </div>

        {/* Score strip */}
        <div className="shrink-0 bg-gray-900 border-t border-gray-800 py-3 px-10 flex justify-center gap-12">
          {sortedTeams.map(team => (
            <div key={team.id} className="text-center">
              <p className="text-gray-400 leading-tight" style={{ fontSize: 'clamp(0.7rem, 1.5vw, 1.1rem)' }}>
                {team.name}
              </p>
              <p className={`font-mono font-black tabular-nums ${
                (scores.get(team.id) ?? 0) < 0 ? 'text-red-400' : 'text-yellow-400'
              }`} style={{ fontSize: 'clamp(1rem, 2.5vw, 2rem)' }}>
                {scores.get(team.id) ?? team.score}
              </p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Fallback
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <p className="text-gray-600 text-2xl animate-pulse">Loading game state…</p>
    </div>
  )
}
