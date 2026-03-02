import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  clearPlayerSession,
  getSessionId,
  getTeamId,
  setTeamId,
} from '../../lib/session'
import type { Buzz, Player, QuestionPublic, Room, Team } from '../../lib/types'

type Phase = 'checking' | 'no_lobby' | 'join_lobby' | 'select_team' | 'lobby' | 'game'

interface TimerPayload {
  start_timestamp: number
  duration_seconds: number
  team_id: string
  buzz_id: string
  team_name: string
}

type BoardCategory = { id: string; name: string; questions: QuestionPublic[] }

interface PreviewInfo {
  questionId: string
  categoryName: string
  pointValue: number | null
  startTs: number
}

export default function PlayView() {
  const [phase, setPhase]             = useState<Phase>('checking')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [room, setRoom]               = useState<Room | null>(null)
  const [teams, setTeams]             = useState<Team[]>([])
  const [myTeam, setMyTeam]           = useState<Team | null>(null)
  const [teammates, setTeammates]     = useState<Player[]>([])
  const [nickname, setNickname]       = useState('')
  const [newTeamName, setNewTeamName] = useState('')
  const [showCreate, setShowCreate]   = useState(false)

  // Game state
  const [activeQuestion, setActiveQuestion]   = useState<QuestionPublic | null>(null)
  const [hasBuzzed, setHasBuzzed]             = useState(false)
  const [myBuzzId, setMyBuzzId]               = useState<string | null>(null)
  const [buzzing, setBuzzing]                 = useState(false)
  const [timerPayload, setTimerPayload]       = useState<TimerPayload | null>(null)
  const [timeRemaining, setTimeRemaining]     = useState<number | null>(null)
  const [responseText, setResponseText]       = useState('')
  const [responseSubmitted, setResponseSubmitted] = useState(false)
  const [buzzResult, setBuzzResult]           = useState<'correct' | 'wrong' | null>(null)
  const [myScore, setMyScore]                 = useState(0)
  const [currentTurnTeamId, setCurrentTurnTeamId] = useState<string | null>(null)
  const [boardCategories, setBoardCategories] = useState<BoardCategory[]>([])
  const [teamNames, setTeamNames]             = useState<Map<string, string>>(new Map())
  const [previewInfo, setPreviewInfo]         = useState<PreviewInfo | null>(null)
  const [previewCountdown, setPreviewCountdown] = useState<number | null>(null)

  // Final Jeopardy state
  type FjSubPhase = 'wager' | 'wager_locked' | 'question' | 'reviewing' | 'done' | null
  const [fjSubPhase, setFjSubPhase]           = useState<FjSubPhase>(null)
  const [fjCategoryName, setFjCategoryName]   = useState('')
  const [fjWagerInput, setFjWagerInput]       = useState('')
  const [fjWagerId, setFjWagerId]             = useState<string | null>(null)
  const [fjQuestion, setFjQuestion]           = useState<QuestionPublic | null>(null)
  const [fjResponse, setFjResponse]           = useState('')
  const [fjResponseSubmitted, setFjResponseSubmitted] = useState(false)
  const [fjTimerStart, setFjTimerStart]       = useState<number | null>(null)
  const [fjTimeRemaining, setFjTimeRemaining] = useState<number | null>(null)
  const [fjFinalScores, setFjFinalScores]     = useState<Array<{ id: string; name: string; score: number }>>([])
  const fjResponseRef = useRef('')
  const fjWagerIdRef  = useRef<string | null>(null)
  useEffect(() => { fjResponseRef.current = fjResponse }, [fjResponse])
  useEffect(() => { fjWagerIdRef.current = fjWagerId }, [fjWagerId])

  // Refs to avoid stale closures in async/broadcast callbacks
  const responseSubmittedRef = useRef(false)
  const myBuzzIdRef          = useRef<string | null>(null)
  const myTeamRef            = useRef<Team | null>(null)
  const roomRef                = useRef<Room | null>(null)
  const broadcastRef           = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const lobbyChannelRef        = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const currentTurnTeamIdRef   = useRef<string | null>(null)

  useEffect(() => { responseSubmittedRef.current = responseSubmitted }, [responseSubmitted])
  useEffect(() => { myBuzzIdRef.current = myBuzzId }, [myBuzzId])
  useEffect(() => { myTeamRef.current = myTeam }, [myTeam])
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { currentTurnTeamIdRef.current = currentTurnTeamId }, [currentTurnTeamId])

  const loadBoard = useCallback(async (roomId: string, round: number) => {
    const { data: cats } = await supabase
      .from('categories').select('id, name').eq('room_id', roomId).eq('round', round).order('name')
    if (!cats?.length) { setBoardCategories([]); return }
    const { data: questions } = await supabase
      .from('questions_public').select().in('category_id', cats.map(c => c.id))
    setBoardCategories(cats.map(cat => ({
      ...cat,
      questions: (questions ?? [])
        .filter(q => q.category_id === cat.id)
        .sort((a, b) => (a.point_value ?? 0) - (b.point_value ?? 0)),
    })))
  }, [])

  const fetchTeammates = useCallback(async (teamId: string) => {
    const { data } = await supabase
      .from('players').select().eq('team_id', teamId).order('created_at', { ascending: true })
    setTeammates(data ?? [])
  }, [])

  // On mount: resume saved session or auto-resolve the single active room
  useEffect(() => {
    const savedTeamId = getTeamId()

    async function autoResolve() {
      const { data } = await supabase
        .from('rooms')
        .select()
        .neq('status', 'finished')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!data) { setPhase('no_lobby'); return }
      setRoom(data)
      setPhase('join_lobby')
    }

    async function resume(teamId: string) {
      const { data: teamData } = await supabase.from('teams').select().eq('id', teamId).single()
      if (!teamData) { clearPlayerSession(); return autoResolve() }
      const { data: roomData } = await supabase
        .from('rooms').select().eq('id', teamData.room_id).neq('status', 'finished').single()
      if (!roomData) { clearPlayerSession(); return autoResolve() }
      setRoom(roomData)
      setMyTeam(teamData)
      setMyScore(teamData.score)
      await fetchTeammates(teamId)
      setPhase(roomData.status === 'lobby' ? 'lobby' : 'game')
    }

    if (savedTeamId) resume(savedTeamId)
    else autoResolve()
  }, [fetchTeammates])

  // Poll for an active room while in 'no_lobby' phase (every 3 seconds)
  useEffect(() => {
    if (phase !== 'no_lobby') return
    const id = setInterval(async () => {
      const { data } = await supabase
        .from('rooms')
        .select()
        .neq('status', 'finished')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) {
        setRoom(data)
        setPhase('join_lobby')
      }
    }, 3000)
    return () => clearInterval(id)
  }, [phase])

  // Subscribe to room updates (once room is known)
  useEffect(() => {
    if (!room?.id) return
    const roomId = room.id
    const ch = supabase.channel(`play-room-${roomId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        payload => setRoom(payload.new as Room))
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          const { data } = await supabase.from('rooms').select().eq('id', roomId).single()
          if (data) setRoom(data)
        }
      })
    return () => { supabase.removeChannel(ch) }
  }, [room?.id])

  // Kick: if room becomes 'finished' while player is in a pre-game phase, send them back
  useEffect(() => {
    if (room?.status !== 'finished') return
    if (['join_lobby', 'select_team', 'lobby'].includes(phase)) {
      clearPlayerSession()
      setRoom(null); setMyTeam(null); setTeams([])
      setPhase('no_lobby')
    }
  }, [room?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Kick via broadcast: host sends lobby_closed on the room channel
  useEffect(() => {
    if (!room?.id || !['join_lobby', 'select_team', 'lobby'].includes(phase)) return
    const ch = supabase.channel(`play-kick-${room.id}`)
      .on('broadcast', { event: 'lobby_closed' }, () => {
        clearPlayerSession()
        setRoom(null); setMyTeam(null); setTeams([])
        setPhase('no_lobby')
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [room?.id, phase])

  // React to room changes → game state transitions
  useEffect(() => {
    if (!room || !myTeam) return

    // Game started
    if (room.status !== 'lobby' && phase === 'lobby') setPhase('game')

    if (room.current_question_id) {
      async function loadQuestion() {
        const qId = room!.current_question_id!

        // New question — clear all state from previous question first
        setTimerPayload(null)
        setBuzzResult(null)
        setHasBuzzed(false)
        setMyBuzzId(null)
        setResponseText('')
        setResponseSubmitted(false)

        const [{ data: question }, { data: existingBuzz }] = await Promise.all([
          supabase.from('questions_public').select().eq('id', qId).single(),
          supabase.from('buzzes').select().eq('question_id', qId).eq('team_id', myTeam!.id).maybeSingle(),
        ])
        setActiveQuestion(question ?? null)
        if (existingBuzz) {
          setHasBuzzed(true)
          setMyBuzzId(existingBuzz.id)
          if (existingBuzz.response) { setResponseText(existingBuzz.response); setResponseSubmitted(true) }
        }
      }
      loadQuestion()
    } else {
      // Question cleared — reset question state; keep buzzResult so feedback stays visible
      setActiveQuestion(null)
      setHasBuzzed(false)
      setMyBuzzId(null)
      setTimerPayload(null)
      setTimeRemaining(null)
      setResponseText('')
      setResponseSubmitted(false)
    }
  }, [room?.current_question_id, room?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to broadcast channel (game phase) — timer + scores + turn
  useEffect(() => {
    if (phase !== 'game' || !room?.id) return

    const ch = supabase.channel(`room:${room.id}`)
      .on('broadcast', { event: 'question_preview' }, ({ payload }) => {
        setPreviewInfo(payload as PreviewInfo)
      })
      .on('broadcast', { event: 'question_activated' }, ({ payload }) => {
        const { question_id } = payload as { question_id: string }
        setPreviewInfo(null)
        setRoom(prev => prev ? { ...prev, current_question_id: question_id } : prev)
      })
      .on('broadcast', { event: 'question_deactivated' }, () => {
        setRoom(prev => prev ? { ...prev, current_question_id: null } : prev)
        // Reload board so answered questions are greyed out immediately
        const r = roomRef.current
        if (r) loadBoard(r.id, r.status === 'round_2' ? 2 : 1)
      })
      .on('broadcast', { event: 'timer_start' }, ({ payload }) => {
        setTimerPayload(payload as TimerPayload)
      })
      .on('broadcast', { event: 'score_update' }, ({ payload }) => {
        const data = payload as {
          teams: Array<{ id: string; score: number }>
          answered_question_id?: string
        }
        const mine = data.teams.find(t => t.id === myTeamRef.current?.id)
        if (mine) setMyScore(mine.score)
        // Grey out the answered question immediately without waiting for a board reload
        if (data.answered_question_id) {
          setBoardCategories(prev => prev.map(cat => ({
            ...cat,
            questions: cat.questions.map(q =>
              q.id === data.answered_question_id ? { ...q, is_answered: true } : q
            ),
          })))
        }
      })
      .on('broadcast', { event: 'turn_change' }, ({ payload }) => {
        const { team_id } = payload as { team_id: string | null }
        setCurrentTurnTeamId(team_id)
      })
      .on('broadcast', { event: 'game_state_change' }, ({ payload }) => {
        const { status, fj_category, active_team_ids } = payload as {
          status: string; fj_category?: string; active_team_ids?: string[]
        }
        const r = roomRef.current
        if (!r) return
        setRoom({ ...r, status: status as Room['status'] })
        if (status === 'round_2') { loadBoard(r.id, 2); return }
        if (status === 'final_jeopardy') {
          setFjCategoryName(fj_category ?? 'Final Jeopardy')
          const myId = myTeamRef.current?.id
          if (!myId) return
          const isActive = active_team_ids ? active_team_ids.includes(myId) : true
          setFjSubPhase(isActive ? 'wager' : 'done')
        }
      })
      .on('broadcast', { event: 'fj_question_revealed' }, async ({ payload }) => {
        const { question_id, start_ts, duration } = payload as { question_id: string; start_ts: number; duration: number }
        const { data: q } = await supabase.from('questions_public').select().eq('id', question_id).single()
        setFjQuestion(q ?? null)
        setFjTimerStart(start_ts)
        setFjTimeRemaining(duration)
        setFjSubPhase('question')
      })
      .on('broadcast', { event: 'fj_timer_expired' }, () => {
        // Auto-submit whatever the player has typed
        const wagerId = fjWagerIdRef.current
        const resp    = fjResponseRef.current.trim()
        if (wagerId) {
          supabase.from('wagers').update({
            response: resp || null,
            submitted_at: new Date().toISOString(),
          }).eq('id', wagerId).then(() => {})
        }
        setFjResponseSubmitted(true)
        setFjSubPhase('reviewing')
      })
      .on('broadcast', { event: 'game_over' }, ({ payload }) => {
        const { scores: s } = payload as { scores: Array<{ id: string; name: string; score: number }> }
        setFjFinalScores(s)
        const mine = s.find(t => t.id === myTeamRef.current?.id)
        if (mine) setMyScore(mine.score)
        setRoom(prev => prev ? { ...prev, status: 'finished' } : prev)
        setFjSubPhase('done')
      })
      .on('broadcast', { event: 'lobby_closed' }, () => {
        clearPlayerSession()
        setRoom(null); setMyTeam(null)
        setPhase('no_lobby')
      })
      .subscribe()

    broadcastRef.current = ch
    return () => { supabase.removeChannel(ch); broadcastRef.current = null }
  }, [phase, room?.id, loadBoard])

  // Load board + team names when entering game phase
  useEffect(() => {
    if (phase !== 'game' || !room?.id) return
    const round = room.status === 'round_2' ? 2 : 1
    loadBoard(room.id, round)
    supabase.from('teams').select('id, name').eq('room_id', room.id).then(({ data }) => {
      if (data) setTeamNames(new Map(data.map(t => [t.id, t.name])))
    })
  }, [phase, room?.id, room?.status, loadBoard])

  // Fallback: if room transitions to final_jeopardy via postgres_changes and fjSubPhase not yet set
  useEffect(() => {
    if (room?.status !== 'final_jeopardy' || fjSubPhase !== null) return
    const myId = myTeam?.id
    if (!myId) return
    // Fetch latest team record to check is_active
    supabase.from('teams').select().eq('id', myId).single().then(({ data: t }) => {
      if (!t) return
      setMyTeam(t)
      setFjSubPhase(prev => prev ?? (t.is_active ? 'wager' : 'done'))
    })
  }, [room?.status, fjSubPhase, myTeam?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-clear correct/wrong feedback after 2.5 s so the board becomes visible
  useEffect(() => {
    if (!buzzResult) return
    const id = setTimeout(() => setBuzzResult(null), 2500)
    return () => clearTimeout(id)
  }, [buzzResult])

  // Picking player activates the question after the 10-second preview
  useEffect(() => {
    if (!previewInfo) return
    const delay = Math.max(0, previewInfo.startTs + 10_000 - Date.now())
    const id = setTimeout(async () => {
      // Only the team whose turn it is runs the actual activation
      if (!roomRef.current || myTeamRef.current?.id !== currentTurnTeamIdRef.current) return
      const { error } = await supabase
        .from('rooms').update({ current_question_id: previewInfo.questionId }).eq('id', roomRef.current.id)
      if (!error) {
        setRoom(prev => prev ? { ...prev, current_question_id: previewInfo.questionId } : prev)
        broadcastRef.current?.send({
          type: 'broadcast',
          event: 'question_activated',
          payload: { question_id: previewInfo.questionId },
        })
        setPreviewInfo(null)
      }
    }, delay)
    return () => clearTimeout(id)
  }, [previewInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Preview countdown display
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

  // Timer countdown
  useEffect(() => {
    if (!timerPayload) { setTimeRemaining(null); return }

    const tick = () => {
      const remaining = Math.max(0, Math.floor(
        (timerPayload.start_timestamp + timerPayload.duration_seconds * 1000 - Date.now()) / 1000
      ))
      setTimeRemaining(remaining)

      if (remaining === 0) {
        // If it's our turn and we haven't submitted, mark expired
        if (timerPayload.team_id === myTeamRef.current?.id && !responseSubmittedRef.current) {
          const buzzId = myBuzzIdRef.current
          if (buzzId) supabase.from('buzzes').update({ status: 'expired' }).eq('id', buzzId).then(() => {})
        }
        clearInterval(id)
      }
    }

    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [timerPayload])

  // FJ 90-second countdown
  useEffect(() => {
    if (fjSubPhase !== 'question' || fjTimerStart === null) return
    const tick = () => {
      const remaining = Math.max(0, Math.floor(
        (fjTimerStart + 90_000 - Date.now()) / 1000
      ))
      setFjTimeRemaining(remaining)
      if (remaining === 0) clearInterval(id)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [fjSubPhase, fjTimerStart])

  // Subscribe to my buzz status changes (for correct/wrong feedback)
  useEffect(() => {
    if (!myBuzzId) return
    const ch = supabase.channel(`play-buzz-${myBuzzId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'buzzes', filter: `id=eq.${myBuzzId}` },
        payload => {
          const updated = payload.new as Buzz
          if (updated.status === 'correct') setBuzzResult('correct')
          else if (updated.status === 'wrong') setBuzzResult('wrong')
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [myBuzzId])

  // Real-time team list updates on the select_team screen
  useEffect(() => {
    if (phase !== 'select_team' || !room?.id) return
    const roomId = room.id

    const refreshTeams = async () => {
      const { data } = await supabase
        .from('teams').select().eq('room_id', roomId).order('created_at', { ascending: true })
      setTeams(data ?? [])
    }

    // postgres_changes covers new teams created; broadcast covers instant join events
    const pgCh = supabase
      .channel(`play-teams-${roomId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${roomId}` },
        refreshTeams)
      .subscribe()

    const roomCh = supabase
      .channel(`room:${roomId}`)
      .on('broadcast', { event: 'team_joined' }, refreshTeams)
      .on('broadcast', { event: 'lobby_closed' }, () => {
        clearPlayerSession()
        setRoom(null); setMyTeam(null); setTeams([])
        setPhase('no_lobby')
      })
      .subscribe()

    lobbyChannelRef.current = roomCh

    return () => {
      supabase.removeChannel(pgCh)
      supabase.removeChannel(roomCh)
      lobbyChannelRef.current = null
    }
  }, [phase, room?.id])

  // Subscribe to teammate joins (lobby only)
  useEffect(() => {
    if (phase !== 'lobby' || !myTeam) return
    const ch = supabase.channel(`play-team-${myTeam.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'players', filter: `team_id=eq.${myTeam.id}` },
        () => fetchTeammates(myTeam.id))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [phase, myTeam, fetchTeammates])

  // ── Actions ───────────────────────────────────────────────

  async function handleJoinLobby() {
    if (!room) return
    const { data: teamData } = await supabase
      .from('teams').select().eq('room_id', room.id).order('created_at', { ascending: true })
    setTeams(teamData ?? [])
    setPhase('select_team')
  }

  function handleLeave() {
    clearPlayerSession()
    setMyTeam(null); setTeammates([])
    setActiveQuestion(null); setHasBuzzed(false)
    setMyBuzzId(null); setTimerPayload(null)
    setBuzzResult(null); setMyScore(0)
    setError('')
    setPhase('select_team')
  }

  async function joinTeam(team: Team) {
    setLoading(true); setError('')
    const { data: player, error: err } = await supabase
      .from('players')
      .insert({ team_id: team.id, session_id: getSessionId(), nickname: nickname.trim() || null })
      .select().single()
    setLoading(false)
    if (!player || err) { setError('Failed to join team. Try again.'); return }

    setTeamId(team.id); setMyTeam(team); setMyScore(team.score)
    await fetchTeammates(team.id)

    // Notify all clients immediately — use the already-subscribed channel so the
    // send goes out instantly without waiting for a new subscription handshake.
    lobbyChannelRef.current?.send({ type: 'broadcast', event: 'team_joined', payload: {} })

    setPhase('lobby')
  }

  async function handleCreateTeam() {
    if (!newTeamName.trim() || !room) return
    setLoading(true)
    const { data: team, error: err } = await supabase
      .from('teams').insert({ room_id: room.id, name: newTeamName.trim() }).select().single()
    if (!team || err) { setLoading(false); setError('Failed to create team. Try again.'); return }
    await joinTeam(team)
  }

  async function handleBuzz() {
    if (!myTeam || !room?.current_question_id || hasBuzzed || buzzing) return
    setBuzzing(true)
    const { data: buzz, error: err } = await supabase
      .from('buzzes')
      .insert({ question_id: room.current_question_id, team_id: myTeam.id, status: 'pending' })
      .select().single()
    setBuzzing(false)
    if (buzz && !err) { setMyBuzzId(buzz.id); setHasBuzzed(true) }
  }

  async function handleSubmitResponse() {
    if (!myBuzzId || !responseText.trim()) return
    await supabase.from('buzzes').update({
      response: responseText.trim(),
      response_submitted_at: new Date().toISOString(),
    }).eq('id', myBuzzId)
    setResponseSubmitted(true)
  }

  function handleSelectQuestion(questionId: string) {
    if (!room || myTeam?.id !== currentTurnTeamId) return
    const cat = boardCategories.find(c => c.questions.some(q => q.id === questionId))
    const q   = cat?.questions.find(q => q.id === questionId)
    const preview: PreviewInfo = {
      questionId,
      categoryName: cat?.name ?? '',
      pointValue:   q?.point_value ?? null,
      startTs:      Date.now(),
    }
    setPreviewInfo(preview)
    broadcastRef.current?.send({
      type: 'broadcast',
      event: 'question_preview',
      payload: preview,
    })
  }

  async function handleSubmitWager() {
    if (!myTeam || !room) return
    const amount = Math.max(0, Math.min(Math.max(0, myScore), parseInt(fjWagerInput) || 0))
    const { data: wager, error: err } = await supabase
      .from('wagers').insert({ team_id: myTeam.id, room_id: room.id, amount, status: 'pending' })
      .select().single()
    if (!wager || err) return
    setFjWagerId(wager.id)
    setFjSubPhase('wager_locked')
    broadcastRef.current?.send({
      type: 'broadcast', event: 'fj_wager_locked', payload: { team_id: myTeam.id },
    })
  }

  async function handleSubmitFJResponse() {
    const wagerId = fjWagerId
    if (!wagerId || !fjResponse.trim()) return
    await supabase.from('wagers').update({
      response: fjResponse.trim(),
      submitted_at: new Date().toISOString(),
    }).eq('id', wagerId)
    setFjResponseSubmitted(true)
  }

  // ── Screens ───────────────────────────────────────────────

  if (phase === 'checking') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400 text-lg animate-pulse">Finding game…</p>
      </div>
    )
  }

  if (phase === 'no_lobby') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-5xl font-black mb-4 text-yellow-400 tracking-tight">Tapped In!</h1>
        <p className="text-gray-400 animate-pulse">Waiting for host to open a lobby…</p>
        <p className="text-gray-600 text-sm mt-2">This page will update automatically.</p>
      </div>
    )
  }

  if (phase === 'join_lobby' && room) {
    const openedAt = new Date(room.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-5xl font-black mb-10 text-yellow-400 tracking-tight">Tapped In!</h1>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-sm mb-6">
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-3">Game Lobby</p>
          <p className="text-white font-black text-2xl mb-1">Tonight's Game</p>
          <p className="text-gray-500 text-sm">Opened at {openedAt}</p>
        </div>
        <button
          onClick={handleJoinLobby}
          className="w-full max-w-sm py-4 rounded-2xl text-xl font-black bg-yellow-400 text-gray-950"
        >
          Join Lobby
        </button>
      </div>
    )
  }

  if (phase === 'select_team') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col p-6">
        <div className="max-w-sm mx-auto w-full pt-10">
          <h1 className="text-center text-4xl font-black text-yellow-400 mb-8">Tapped In!</h1>
          <input
            type="text"
            placeholder="Your nickname (optional)"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 mb-6 outline-none focus:ring-2 focus:ring-yellow-400 text-sm"
          />
          {teams.length > 0 && (
            <>
              <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold mb-3">Join a team</p>
              <div className="space-y-2 mb-4">
                {teams.map(team => (
                  <button
                    key={team.id}
                    onClick={() => joinTeam(team)}
                    disabled={loading}
                    className="w-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl px-5 py-4 text-left font-semibold transition-colors"
                  >
                    {team.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {!showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              className="w-full border-2 border-yellow-400 text-yellow-400 rounded-xl px-4 py-3 font-bold"
            >
              + Create New Team
            </button>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Team name"
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateTeam()}
                autoFocus
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-yellow-400"
              />
              <button
                onClick={handleCreateTeam}
                disabled={loading || !newTeamName.trim()}
                className="w-full py-3 rounded-xl font-black bg-yellow-400 text-gray-950 disabled:opacity-30"
              >
                {loading ? 'Creating…' : 'Create & Join'}
              </button>
            </div>
          )}
          {error && <p className="text-red-400 text-sm text-center mt-4">{error}</p>}
        </div>
      </div>
    )
  }

  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <span className="w-3 h-3 rounded-full bg-green-400 mb-6 animate-pulse inline-block" />
        <p className="text-gray-500 text-xs uppercase tracking-widest mb-1">You're on</p>
        <h2 className="text-4xl font-black text-yellow-400 mb-2">{myTeam?.name}</h2>
        <p className="text-gray-500 text-sm mb-10">Waiting for the host to start the game…</p>
        {teammates.length > 0 && (
          <div className="bg-gray-900 rounded-2xl px-8 py-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-3">Team members</p>
            <ul className="space-y-2">
              {teammates.map(p => (
                <li key={p.id} className="text-white font-medium">{p.nickname ?? 'Anonymous'}</li>
              ))}
            </ul>
          </div>
        )}
        <button onClick={handleLeave} className="mt-8 text-xs text-gray-700 hover:text-gray-500 transition-colors">
          Leave team
        </button>
      </div>
    )
  }

  // ── Game phase ────────────────────────────────────────────

  const scoreChip = (
    <div className="absolute top-4 right-4 bg-gray-900 border border-gray-800 rounded-full px-4 py-1.5 text-sm font-mono font-bold text-yellow-400">
      {myScore} pts
    </div>
  )

  // ── Final Jeopardy screens ────────────────────────────────

  if (fjSubPhase === 'wager') {
    const maxWager = Math.max(0, myScore)
    const wagerVal = Math.max(0, Math.min(maxWager, parseInt(fjWagerInput) || 0))
    const valid    = fjWagerInput !== '' && wagerVal >= 0
    return (
      <div className="min-h-screen bg-blue-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <p className="text-blue-400 text-xs uppercase tracking-widest mb-2">Final Jeopardy</p>
        <p className="text-3xl font-black text-white mb-1">{fjCategoryName}</p>
        <p className="text-gray-400 text-sm mb-8">Enter your wager (max: {maxWager} pts)</p>
        <div className="w-full max-w-xs space-y-4">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={maxWager}
            placeholder="0"
            value={fjWagerInput}
            onChange={e => setFjWagerInput(e.target.value)}
            className="w-full bg-gray-800 text-white text-center text-5xl font-mono font-black rounded-2xl px-4 py-5 outline-none focus:ring-2 focus:ring-yellow-400"
          />
          {fjWagerInput !== '' && wagerVal !== parseInt(fjWagerInput) && (
            <p className="text-yellow-400 text-xs">Capped at {maxWager}</p>
          )}
          <button
            onClick={handleSubmitWager}
            disabled={!valid}
            className="w-full py-4 rounded-2xl text-lg font-black bg-yellow-400 text-gray-950 disabled:opacity-30"
          >
            Lock In Wager: {wagerVal} pts
          </button>
        </div>
      </div>
    )
  }

  if (fjSubPhase === 'wager_locked') {
    return (
      <div className="min-h-screen bg-blue-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-3 h-3 rounded-full bg-green-400 mb-6 animate-pulse" />
        <p className="text-2xl font-black text-white mb-2">Wager locked in</p>
        <p className="text-gray-400 text-sm">Waiting for other teams…</p>
        <p className="text-blue-400 text-xs uppercase tracking-widest mt-10">{fjCategoryName}</p>
      </div>
    )
  }

  if (fjSubPhase === 'question' && fjQuestion) {
    const dur       = 90
    const remaining = fjTimeRemaining ?? dur
    const pct       = (remaining / dur) * 100
    const low       = remaining <= 15
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        {/* Timer bar */}
        <div className="h-2 bg-gray-900 w-full shrink-0">
          <div
            className={`h-full transition-all duration-500 ${low ? 'bg-red-500' : 'bg-yellow-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex-1 flex flex-col p-5 max-w-sm mx-auto w-full">
          <div className="flex items-center justify-between mb-4 pt-3">
            <p className="text-blue-400 text-xs uppercase tracking-widest">Final Jeopardy</p>
            <span className={`font-mono text-3xl font-black tabular-nums ${low ? 'text-red-400' : 'text-white'}`}>
              {remaining}
            </span>
          </div>
          <div className="bg-gray-900 rounded-2xl p-5 mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">The Answer</p>
            <p className="text-xl font-bold leading-snug">{fjQuestion.answer}</p>
          </div>
          {fjResponseSubmitted ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-3 h-3 rounded-full bg-yellow-400 animate-pulse" />
              <p className="text-white font-black text-xl">Response submitted</p>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-3 max-w-xs">
                <p className="text-gray-300 italic">"{fjResponse}"</p>
              </div>
            </div>
          ) : (
            <>
              <textarea
                autoFocus
                placeholder="Type your response…"
                value={fjResponse}
                onChange={e => setFjResponse(e.target.value)}
                rows={3}
                className="w-full bg-gray-800 text-white rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-yellow-400 resize-none text-lg mb-4"
              />
              <button
                onClick={handleSubmitFJResponse}
                disabled={!fjResponse.trim()}
                className="w-full py-4 rounded-2xl font-black text-lg bg-yellow-400 text-gray-950 disabled:opacity-30"
              >
                Submit Response
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  if (fjSubPhase === 'reviewing') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-3 h-3 rounded-full bg-gray-600 mb-6 animate-pulse" />
        <p className="text-2xl font-black text-white mb-2">Time's up!</p>
        <p className="text-gray-500 text-sm">The host is reviewing answers…</p>
      </div>
    )
  }

  if (fjSubPhase === 'done') {
    const winner = [...fjFinalScores].sort((a, b) => b.score - a.score)[0]
    const myEntry = fjFinalScores.find(t => t.id === myTeam?.id)
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <p className="text-gray-500 text-xs uppercase tracking-widest mb-2">Game Over</p>
        <p className="text-4xl font-black text-yellow-400 mb-8">{winner?.name ?? '?'} wins!</p>
        {fjFinalScores.length > 0 && (
          <div className="w-full max-w-xs space-y-2 mb-8">
            {[...fjFinalScores].sort((a, b) => b.score - a.score).map((t, i) => (
              <div key={t.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 ${t.id === myTeam?.id ? 'bg-yellow-400/10 border border-yellow-400/30' : 'bg-gray-900'}`}>
                <span className="text-gray-600 font-mono w-5 text-center text-sm">{i + 1}</span>
                <span className="flex-1 font-semibold text-left">{t.name}</span>
                <span className={`font-mono font-black text-sm ${t.score < 0 ? 'text-red-400' : 'text-yellow-400'}`}>{t.score}</span>
              </div>
            ))}
          </div>
        )}
        {myEntry && (
          <p className="text-gray-400 text-sm">Your final score: <span className="text-white font-black">{myEntry.score}</span></p>
        )}
        <button onClick={handleLeave} className="mt-6 text-xs text-gray-700 hover:text-gray-500 transition-colors">
          Leave
        </button>
      </div>
    )
  }

  // ── Check buzzResult FIRST so feedback persists after question is cleared ──

  if (buzzResult === 'correct') {
    return (
      <div className="relative min-h-screen bg-green-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreChip}
        <div className="text-8xl mb-6 leading-none">✓</div>
        <p className="text-5xl font-black text-green-400 mb-3">Correct!</p>
        {activeQuestion?.point_value && (
          <p className="text-green-300 text-xl font-semibold">+{activeQuestion.point_value} points</p>
        )}
      </div>
    )
  }

  if (buzzResult === 'wrong') {
    return (
      <div className="relative min-h-screen bg-red-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreChip}
        <div className="text-8xl mb-6 leading-none">✗</div>
        <p className="text-5xl font-black text-red-400 mb-3">Wrong!</p>
        {activeQuestion?.point_value && (
          <p className="text-red-300 text-xl font-semibold">−{activeQuestion.point_value} points</p>
        )}
        <p className="text-gray-500 text-sm mt-4">Waiting for other teams…</p>
      </div>
    )
  }

  // No active question — check for preview phase first
  if (!activeQuestion) {
    // ── Preview: category revealed, countdown to buzz ──
    if (previewInfo) {
      const cnt = previewCountdown ?? 10
      return (
        <div className="min-h-screen bg-blue-950 text-white flex flex-col items-center justify-center p-6 text-center">
          {scoreChip}
          <p className="text-blue-400 text-xs uppercase tracking-widest mb-6">Category</p>
          <p className="font-black text-white leading-tight mb-3"
            style={{ fontSize: 'clamp(1.75rem, 7vw, 3rem)' }}>
            {previewInfo.categoryName}
          </p>
          {previewInfo.pointValue != null && (
            <p className="text-yellow-400 font-mono font-black text-3xl mb-10">
              ${previewInfo.pointValue}
            </p>
          )}
          <p className={`font-mono font-black tabular-nums leading-none animate-pulse ${
            cnt <= 3 ? 'text-red-400' : 'text-yellow-400'
          }`} style={{ fontSize: 'clamp(5rem, 20vw, 8rem)' }}>
            {cnt}
          </p>
        </div>
      )
    }

    const isMyTurnNow  = myTeam?.id === currentTurnTeamId
    const turnTeamName = currentTurnTeamId ? teamNames.get(currentTurnTeamId) : null
    const pointValues  = [...new Set(
      boardCategories.flatMap(c => c.questions.map(q => q.point_value ?? 0)).filter(Boolean)
    )].sort((a, b) => a - b)
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        {scoreChip}

        <div className="pt-16 pb-3 px-4 text-center shrink-0">
          {isMyTurnNow ? (
            <p className="text-yellow-400 font-black text-xl animate-pulse">Your pick!</p>
          ) : turnTeamName ? (
            <p className="text-gray-400 text-sm">
              <span className="text-white font-semibold">{turnTeamName}</span> is choosing…
            </p>
          ) : (
            <p className="text-gray-600 text-sm">Waiting for next question…</p>
          )}
        </div>

        {boardCategories.length > 0 ? (
          <div className="flex-1 px-2 pb-2 overflow-auto">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${boardCategories.length}, minmax(0, 1fr))` }}
            >
              {boardCategories.map(cat => (
                <div key={cat.id} className="bg-blue-900 rounded px-1 py-2 text-center">
                  <p className="font-black uppercase leading-tight text-white"
                    style={{ fontSize: 'clamp(0.5rem, 2.5vw, 0.7rem)' }}>
                    {cat.name}
                  </p>
                </div>
              ))}
              {pointValues.flatMap(pv =>
                boardCategories.map(cat => {
                  const q = cat.questions.find(q => q.point_value === pv)
                  if (!q) return <div key={`${cat.id}-${pv}`} className="h-12 rounded bg-gray-900/20" />
                  const answered = q.is_answered
                  return (
                    <button
                      key={q.id}
                      onClick={() => isMyTurnNow && !answered && handleSelectQuestion(q.id)}
                      disabled={answered || !isMyTurnNow}
                      className={`h-12 rounded font-mono font-black transition-colors ${
                        answered
                          ? 'bg-gray-900/30 text-gray-800 cursor-default'
                          : isMyTurnNow
                            ? 'bg-blue-800 hover:bg-blue-700 active:bg-blue-600 text-yellow-400'
                            : 'bg-blue-900/60 text-blue-400 cursor-default'
                      }`}
                      style={{ fontSize: 'clamp(0.65rem, 2.5vw, 0.9rem)' }}
                    >
                      {answered ? '' : `$${pv}`}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-600 text-sm">Loading board…</p>
          </div>
        )}

        <button onClick={handleLeave}
          className="shrink-0 py-3 text-xs text-gray-800 hover:text-gray-600 transition-colors text-center w-full">
          Leave team
        </button>
      </div>
    )
  }

  // It's our turn to respond
  const isMyTurn = timerPayload?.team_id === myTeam?.id
  const dur = timerPayload?.duration_seconds ?? 30
  const remaining = timeRemaining ?? dur
  const timerPct = (remaining / dur) * 100
  const timerLow = remaining <= 10

  if (hasBuzzed && isMyTurn && !responseSubmitted) {
    return (
      <div className="relative min-h-screen bg-gray-950 text-white flex flex-col p-6">
        {scoreChip}
        <div className="max-w-sm mx-auto w-full flex flex-col flex-1 pt-8">
          <div className="flex items-center justify-between mb-2">
            <p className="text-yellow-400 font-black text-xl">Your turn!</p>
            <span className={`font-mono text-4xl font-black tabular-nums ${timerLow ? 'text-red-400' : 'text-white'}`}>
              {remaining}
            </span>
          </div>

          {/* Timer bar */}
          <div className="w-full h-2 bg-gray-800 rounded-full mb-6 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${timerLow ? 'bg-red-500' : 'bg-yellow-400'}`}
              style={{ width: `${timerPct}%` }}
            />
          </div>

          <div className="bg-gray-900 rounded-2xl p-4 mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">The answer</p>
            <p className="text-lg font-bold leading-snug">{activeQuestion.answer}</p>
          </div>

          <textarea
            autoFocus
            placeholder="Type your response…"
            value={responseText}
            onChange={e => setResponseText(e.target.value)}
            rows={3}
            className="w-full bg-gray-800 text-white rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-yellow-400 resize-none text-lg mb-4"
          />

          <button
            onClick={handleSubmitResponse}
            disabled={!responseText.trim()}
            className="w-full py-4 rounded-2xl font-black text-lg bg-yellow-400 text-gray-950 disabled:opacity-30"
          >
            Submit Response
          </button>
        </div>
      </div>
    )
  }

  // Response submitted — waiting for host judgment
  if (hasBuzzed && responseSubmitted) {
    return (
      <div className="relative min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreChip}
        <div className="w-3 h-3 rounded-full bg-yellow-400 mb-6 animate-pulse" />
        <p className="text-2xl font-black text-white mb-2">Response submitted</p>
        <p className="text-gray-500 text-sm mb-6">Waiting for the host…</p>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-4 max-w-xs">
          <p className="text-gray-300 italic">"{responseText}"</p>
        </div>
      </div>
    )
  }

  // Another team is responding — stand-by
  if (hasBuzzed && timerPayload && !isMyTurn) {
    return (
      <div className="relative min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreChip}
        <div className="w-3 h-3 rounded-full bg-gray-600 mb-6 animate-pulse" />
        <p className="text-2xl font-black text-white mb-1">Stand by</p>
        <p className="text-gray-500 text-sm">
          <span className="text-gray-300 font-semibold">{timerPayload.team_name}</span> is responding…
        </p>
        <p className={`font-mono text-5xl font-black mt-8 tabular-nums ${timerLow ? 'text-red-400' : 'text-gray-400'}`}>
          {remaining}
        </p>
      </div>
    )
  }

  // Buzzed — waiting in the queue
  if (hasBuzzed) {
    return (
      <div className="relative min-h-screen bg-gray-950 text-white flex flex-col p-6">
        {scoreChip}
        <div className="max-w-sm mx-auto w-full pt-10">
          <div className="bg-gray-900 rounded-2xl p-5 mb-6">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">The answer</p>
            <p className="text-xl font-bold leading-snug">{activeQuestion.answer}</p>
          </div>
          <div className="text-center">
            <div className="w-5 h-5 rounded-full bg-yellow-400 mx-auto mb-5 animate-pulse" />
            <p className="text-yellow-400 font-black text-2xl mb-1">Buzzed in!</p>
            <p className="text-gray-500 text-sm">Waiting for your turn…</p>
          </div>
        </div>
      </div>
    )
  }

  // Active question — BUZZ button
  return (
    <div className="relative min-h-screen bg-gray-950 text-white flex flex-col p-5">
      {scoreChip}
      <div className="max-w-sm mx-auto w-full flex flex-col" style={{ minHeight: 'calc(100vh - 2.5rem)' }}>
        <div className="bg-gray-900 rounded-2xl p-5 mb-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">The answer</p>
          <p className="text-2xl font-bold leading-snug">{activeQuestion.answer}</p>
          {activeQuestion.point_value && (
            <p className="text-yellow-400 font-mono text-sm mt-3 font-semibold">{activeQuestion.point_value} pts</p>
          )}
        </div>
        <button
          onClick={handleBuzz}
          disabled={buzzing}
          className="flex-1 w-full rounded-2xl font-black text-5xl tracking-wider
                     bg-red-600 hover:bg-red-500 active:bg-red-700 disabled:bg-red-900
                     text-white transition-colors
                     shadow-[0_0_60px_rgba(220,38,38,0.5)]
                     min-h-52"
        >
          {buzzing ? '…' : 'BUZZ!'}
        </button>
      </div>
    </div>
  )
}
