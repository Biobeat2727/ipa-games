import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ablyClient } from '../../lib/ably'
import {
  clearPlayerSession,
  getSessionId,
  getTeamId,
  setTeamId,
} from '../../lib/session'
import type { Buzz, Player, QuestionPublic, Room, Team } from '../../lib/types'
import AnimatedScore from '../../components/AnimatedScore'
import Confetti from '../../components/Confetti'
import ScoreOverlay from '../../components/ScoreOverlay'
import { QUIPS } from '../../lib/quips'
import {
  playBuzz,
  playCorrect,
  playWrong,
  playDoubleTap,
} from '../../lib/sounds'

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
  doubleTapWager?: number
}

// ── Quip cycler component ─────────────────────────────────────

function QuipCycler() {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * QUIPS.length))
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIdx(prev => (prev + 1) % QUIPS.length)
        setVisible(true)
      }, 400)
    }, 4500)
    return () => clearInterval(id)
  }, [])

  return (
    <p
      className="text-gray-600 text-xs mt-6 max-w-xs text-center px-4 leading-relaxed"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease' }}
    >
      {QUIPS[idx]}
    </p>
  )
}

// ── Main component ────────────────────────────────────────────

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
  const [flippingId, setFlippingId]   = useState<string | null>(null)
  const [tileRect, setTileRect]         = useState<DOMRect | null>(null)
  const [overlayExpanding, setOverlayExpanding] = useState(false)

  // Game state
  const [activeQuestion, setActiveQuestion]   = useState<QuestionPublic | null>(null)
  const [hasBuzzed, setHasBuzzed]             = useState(false)
  const [myBuzzId, setMyBuzzId]               = useState<string | null>(null)
  const [buzzing, setBuzzing]                 = useState(false)
  const [timerPayload, setTimerPayload]         = useState<TimerPayload | null>(null)
  const [buzzWindowTs, setBuzzWindowTs]         = useState<number | null>(null)
  const [timeRemaining, setTimeRemaining]       = useState<number | null>(null)
  const [responseText, setResponseText]       = useState('')
  const [responseSubmitted, setResponseSubmitted] = useState(false)
  const [buzzPosition, setBuzzPosition]       = useState<number | null>(null)
  const [buzzResult, setBuzzResult]           = useState<'correct' | 'wrong' | null>(null)
  const [myScore, setMyScore]                 = useState(0)
  const [allTeamScores, setAllTeamScores]     = useState<Array<{ id: string; name: string; score: number }>>([])
  const [currentTurnTeamId, setCurrentTurnTeamId] = useState<string | null>(null)
  const [boardCategories, setBoardCategories] = useState<BoardCategory[]>([])
  const [teamNames, setTeamNames]             = useState<Map<string, string>>(new Map())
  const [previewInfo, setPreviewInfo]         = useState<PreviewInfo | null>(null)
  const [doubleTapTeamId, setDoubleTapTeamId] = useState<string | null>(null)
  const [dtRevealForObserver, setDtRevealForObserver] = useState(false)

  // UI state
  const [showScoreOverlay, setShowScoreOverlay] = useState(false)
  const [scoreChipPulse, setScoreChipPulse]     = useState(false)
  const [showConfetti, setShowConfetti]           = useState(false)
  const [ripples, setRipples]                     = useState<Array<{ id: number; x: number; y: number }>>([])

  // Double Tap state
  const [doubleTapStep, setDoubleTapStep]       = useState<'reveal' | 'wager' | null>(null)
  const [doubleTapPendingQ, setDoubleTapPendingQ] = useState<{
    questionId: string; rect: DOMRect
  } | null>(null)
  const [doubleTapWagerInput, setDoubleTapWagerInput] = useState('')

  // Final Jeopardy state
  type FjSubPhase = 'incoming' | 'wager' | 'wager_locked' | 'question' | 'reviewing' | 'done' | null
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

  // Refs to avoid stale closures
  const responseSubmittedRef = useRef(false)
  const responseTextRef      = useRef('')
  const myBuzzIdRef          = useRef<string | null>(null)
  const myTeamRef            = useRef<Team | null>(null)
  const roomRef                = useRef<Room | null>(null)
  const broadcastRef           = useRef<ReturnType<typeof ablyClient.channels.get> | null>(null)
  const lobbyChannelRef        = useRef<ReturnType<typeof ablyClient.channels.get> | null>(null)
  const teamChannelRef         = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const currentTurnTeamIdRef   = useRef<string | null>(null)
  const prevScoreRef           = useRef(0)
  const dtAutoBuzzedRef        = useRef<string | null>(null) // tracks question ID already auto-buzzed
  const phaseRef               = useRef<Phase>(phase)
  const pendingSwReloadRef     = useRef(false)

  useEffect(() => { responseSubmittedRef.current = responseSubmitted }, [responseSubmitted])
  useEffect(() => { responseTextRef.current = responseText }, [responseText])
  useEffect(() => { myBuzzIdRef.current = myBuzzId }, [myBuzzId])
  useEffect(() => { myTeamRef.current = myTeam }, [myTeam])
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { currentTurnTeamIdRef.current = currentTurnTeamId }, [currentTurnTeamId])
  useEffect(() => { phaseRef.current = phase }, [phase])

  // SW update: reload immediately if not mid-game, otherwise defer until game ends
  useEffect(() => {
    if (!navigator.serviceWorker) return
    const handler = () => {
      if (phaseRef.current !== 'game') {
        window.location.reload()
      } else {
        pendingSwReloadRef.current = true
      }
    }
    navigator.serviceWorker.addEventListener('controllerchange', handler)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handler)
  }, [])

  // Deferred SW reload — fires when game ends and a reload was queued
  useEffect(() => {
    if (phase !== 'game' && pendingSwReloadRef.current) {
      window.location.reload()
    }
  }, [phase])


  // Score chip pulse on score change
  useEffect(() => {
    if (myScore === prevScoreRef.current) return
    prevScoreRef.current = myScore
    setScoreChipPulse(true)
    const id = setTimeout(() => setScoreChipPulse(false), 600)
    return () => clearTimeout(id)
  }, [myScore])

  // Sound + haptics + confetti on buzz result
  useEffect(() => {
    if (buzzResult === 'correct') {
      playCorrect()
      navigator.vibrate?.([100, 50, 200])
      setShowConfetti(true)
    } else if (buzzResult === 'wrong') {
      playWrong()
      navigator.vibrate?.(200)
    }
  }, [buzzResult])

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

  // Load all team scores for overlay
  const refreshAllScores = useCallback(async (roomId: string) => {
    const { data } = await supabase.from('teams').select('id, name, score').eq('room_id', roomId)
    if (data) setAllTeamScores(data)
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
      // Hydrate turn from DB on resume
      if (roomData.current_turn_team_id !== undefined) {
        setCurrentTurnTeamId(roomData.current_turn_team_id ?? null)
      }
      await fetchTeammates(teamId)
      await refreshAllScores(roomData.id)
      setPhase(roomData.status === 'lobby' ? 'lobby' : 'game')
    }

    if (savedTeamId) resume(savedTeamId)
    else autoResolve()
  }, [fetchTeammates, refreshAllScores])

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

  // Subscribe to room updates (once room is known) + polling fallback
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
    // Polling fallback
    const poll = setInterval(async () => {
      const { data } = await supabase.from('rooms').select().eq('id', roomId).single()
      if (data) setRoom(data)
    }, 3000)
    return () => { supabase.removeChannel(ch); clearInterval(poll) }
  }, [room?.id])

  // Hydrate currentTurnTeamId from room.current_turn_team_id (polling fallback for turn persistence)
  useEffect(() => {
    if (phase === 'game' && room?.current_turn_team_id !== undefined) {
      setCurrentTurnTeamId(room.current_turn_team_id ?? null)
    }
  }, [room?.current_turn_team_id, phase])

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
    const ch = ablyClient.channels.get(`play-kick-${room.id}`)
    ch.subscribe('lobby_closed', () => {
      clearPlayerSession()
      setRoom(null); setMyTeam(null); setTeams([])
      setPhase('no_lobby')
    })
    return () => { ch.unsubscribe() }
  }, [room?.id, phase])

  // React to room changes → game state transitions
  useEffect(() => {
    if (!room || !myTeam) return

    // Game started
    if (room.status !== 'lobby' && phase === 'lobby') setPhase('game')

    if (room.current_question_id) {
      let cancelled = false
      async function loadQuestion() {
        const qId = room!.current_question_id!

        // New question — clear all state from previous question first
        setTimerPayload(null)
        setBuzzResult(null)
        setHasBuzzed(false)
        setMyBuzzId(null)
        setBuzzPosition(null)
        setResponseText('')
        setResponseSubmitted(false)

        const [{ data: question }, { data: existingBuzz }] = await Promise.all([
          supabase.from('questions_public').select().eq('id', qId).single(),
          supabase.from('buzzes').select().eq('question_id', qId).eq('team_id', myTeam!.id).maybeSingle(),
        ])
        if (cancelled) return
        setActiveQuestion(question ?? null)
        if (existingBuzz) {
          setHasBuzzed(true)
          setMyBuzzId(existingBuzz.id)
          if (existingBuzz.response) { setResponseText(existingBuzz.response); setResponseSubmitted(true) }
        }
      }
      loadQuestion()
      return () => { cancelled = true }
    } else {
      // Question cleared — reset question state; keep buzzResult so feedback stays visible
      setActiveQuestion(null)
      setHasBuzzed(false)
      setMyBuzzId(null)
      setBuzzPosition(null)
      setTimerPayload(null)
      setTimeRemaining(null)
      setResponseText('')
      setResponseSubmitted(false)
    }
  }, [room?.current_question_id, room?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to broadcast channel (game phase) — timer + scores + turn
  useEffect(() => {
    if (phase !== 'game' || !room?.id) return

    const ch = ablyClient.channels.get(`room:${room.id}`)

    ch.subscribe('question_preview', ({ data }) => {
      const p = data as PreviewInfo & { selectorTeamId?: string; doubleTapPending?: boolean }

      // First DT broadcast (tile tap, before wager) — observers show the reveal animation
      if (p.doubleTapPending && p.selectorTeamId) {
        setDoubleTapTeamId(p.selectorTeamId)
        if (p.selectorTeamId !== myTeamRef.current?.id) {
          setDtRevealForObserver(true)
        }
        return // don't show previewInfo yet — wait for the real preview after wager
      }

      // Real preview (post-wager or normal question)
      setPreviewInfo(p)
      if (p.doubleTapWager !== undefined && p.selectorTeamId) {
        setDoubleTapTeamId(p.selectorTeamId)
        setDtRevealForObserver(false) // transition to preview overlay
      }
    })
    ch.subscribe('question_activated', ({ data }) => {
      const { question_id, double_tap_team_id, buzz_opened_at } = data as { question_id: string; double_tap_team_id?: string; buzz_opened_at?: number }
      setPreviewInfo(null)
      setDoubleTapTeamId(double_tap_team_id ?? null)
      setBuzzWindowTs(buzz_opened_at ?? null)
      setRoom(prev => prev ? { ...prev, current_question_id: question_id } : prev)
    })
    ch.subscribe('question_deactivated', () => {
      dtAutoBuzzedRef.current = null
      setDtRevealForObserver(false)
      setRoom(prev => prev ? { ...prev, current_question_id: null } : prev)
      setActiveQuestion(null)
      setHasBuzzed(false)
      setMyBuzzId(null)
      setBuzzPosition(null)
      setTimerPayload(null)
      setBuzzWindowTs(null)
      setResponseSubmitted(false)
      setPreviewInfo(null)
      setDoubleTapTeamId(null)
      // Reload board so answered questions are greyed out immediately
      const r = roomRef.current
      if (r) loadBoard(r.id, r.status === 'round_2' ? 2 : 1)
    })
    ch.subscribe('timer_start', ({ data }) => {
      const p = data as TimerPayload
      // Only our team's timer is relevant — ignore other teams' buzzes entirely
      if (p.team_id !== myTeamRef.current?.id) return
      setTimerPayload(prev => {
        // Don't override same buzz (DT auto-buzz)
        if (prev?.buzz_id === p.buzz_id) return prev
        return p
      })
    })
    ch.subscribe('score_update', ({ data: upd }) => {
      const msg = upd as {
        teams: Array<{ id: string; name: string; score: number }>
        answered_question_id?: string
        winning_team_id?: string
        wrong_buzz_id?: string
      }
      const mine = msg.teams.find(t => t.id === myTeamRef.current?.id)
      if (mine) setMyScore(mine.score)
      setAllTeamScores(msg.teams)
      // Set buzz feedback via broadcast (reliable) — fires before question_deactivated clears myBuzzId
      if (msg.winning_team_id && msg.winning_team_id === myTeamRef.current?.id) {
        setBuzzResult('correct')
      } else if (msg.wrong_buzz_id && msg.wrong_buzz_id === myBuzzIdRef.current) {
        setBuzzResult('wrong')
        setTimerPayload(null) // prevent answer box from reappearing after timer expires
      }
      // Grey out the answered question immediately without waiting for a board reload
      if (msg.answered_question_id) {
        setBoardCategories(prev => prev.map(cat => ({
          ...cat,
          questions: cat.questions.map(q =>
            q.id === msg.answered_question_id ? { ...q, is_answered: true } : q
          ),
        })))
      }
    })
    ch.subscribe('turn_change', ({ data }) => {
      const { team_id } = data as { team_id: string | null }
      setCurrentTurnTeamId(team_id)
    })
    ch.subscribe('game_state_change', ({ data }) => {
      const { status, fj_category } = data as { status: string; fj_category?: string }
      const r = roomRef.current
      if (!r) return
      setRoom({ ...r, status: status as Room['status'] })
      if (status === 'round_1' || status === 'round_2') {
        // New round — wipe all mid-game state
        setPreviewInfo(null)
        setActiveQuestion(null)
        setCurrentTurnTeamId(null)
        setTimerPayload(null)
        setBuzzWindowTs(null)
        setHasBuzzed(false)
        setMyBuzzId(null)
        setBuzzPosition(null)
        setBuzzResult(null)
        setDoubleTapTeamId(null)
        setDtRevealForObserver(false)
        loadBoard(r.id, status === 'round_2' ? 2 : 1)
        return
      }
      if (status === 'final_jeopardy') {
        setFjCategoryName(fj_category ?? 'Final Jeopardy')
        setFjWagerInput(''); setFjWagerId(null); setFjQuestion(null)
        setFjResponse(''); setFjResponseSubmitted(false)
        setFjTimerStart(null); setFjTimeRemaining(null); setFjFinalScores([])
        setFjSubPhase('incoming')
      }
    })
    ch.subscribe('fj_question_revealed', async ({ data }) => {
      const { question_id, start_ts, duration } = data as { question_id: string; start_ts: number; duration: number }
      const { data: q } = await supabase.from('questions_public').select().eq('id', question_id).single()
      setFjQuestion(q ?? null)
      setFjTimerStart(start_ts)
      setFjTimeRemaining(duration)
      setFjSubPhase('question')
    })
    ch.subscribe('fj_wager_open', ({ data }) => {
      const { active_team_ids } = data as { active_team_ids?: string[] }
      const myId = myTeamRef.current?.id
      if (!myId) return
      const isActive = active_team_ids ? active_team_ids.includes(myId) : true
      setFjSubPhase(isActive ? 'wager' : 'done')
    })
    ch.subscribe('fj_timer_expired', () => {
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
    ch.subscribe('game_over', ({ data }) => {
      const { scores: s } = data as { scores: Array<{ id: string; name: string; score: number }> }
      setFjFinalScores(s)
      const mine = s.find(t => t.id === myTeamRef.current?.id)
      if (mine) setMyScore(mine.score)
      setRoom(prev => prev ? { ...prev, status: 'finished' } : prev)
      setFjSubPhase('done')
    })
    ch.subscribe('lobby_closed', () => {
      clearPlayerSession()
      setPreviewInfo(null); setActiveQuestion(null); setCurrentTurnTeamId(null)
      setTimerPayload(null); setBuzzWindowTs(null); setHasBuzzed(false); setMyBuzzId(null); setBuzzPosition(null); setBuzzResult(null)
      setDoubleTapTeamId(null); setDtRevealForObserver(false)
      setRoom(null); setMyTeam(null)
      setFjSubPhase(null)
      setPhase('no_lobby')
    })

    ch.subscribe('team_answer_submitted', ({ data }) => {
      const p = data as { team_id: string; buzz_id: string; buzzPosition: number | null; response?: string }
      if (p.team_id === myTeamRef.current?.id && !responseSubmittedRef.current) {
        setBuzzPosition(p.buzzPosition)
        if (p.response) setResponseText(p.response)
        setResponseSubmitted(true)
        responseSubmittedRef.current = true
      }
    })

    broadcastRef.current = ch
    return () => { ch.unsubscribe(); broadcastRef.current = null }
  }, [phase, room?.id, loadBoard])

  // Load board + team names when entering game phase
  useEffect(() => {
    if (phase !== 'game' || !room?.id) return
    const round = room.status === 'round_2' ? 2 : 1
    loadBoard(room.id, round)
    supabase.from('teams').select('id, name, score').eq('room_id', room.id).then(({ data }) => {
      if (data) {
        setTeamNames(new Map(data.map(t => [t.id, t.name])))
        setAllTeamScores(data)
      }
    })
  }, [phase, room?.id, room?.status, loadBoard])

  // Fallback: if room transitions to final_jeopardy via postgres_changes and fjSubPhase not yet set
  useEffect(() => {
    if (room?.status !== 'final_jeopardy' || fjSubPhase !== null) return
    const myId = myTeam?.id
    if (!myId) return
    supabase.from('teams').select().eq('id', myId).single().then(({ data: t }) => {
      if (!t) return
      setMyTeam(t)
      setFjSubPhase(prev => prev ?? 'incoming')
    })
  }, [room?.status, fjSubPhase, myTeam?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-clear correct/wrong feedback after 2.5 s
  useEffect(() => {
    if (!buzzResult) return
    const id = setTimeout(() => setBuzzResult(null), 2500)
    return () => clearTimeout(id)
  }, [buzzResult])

  // Fallback: if question loads but buzz_opened_at broadcast was missed (e.g. arrived via DB poll),
  // start the timer from now so the countdown always appears.
  useEffect(() => {
    if (!activeQuestion || doubleTapTeamId || buzzWindowTs) return
    setBuzzWindowTs(Date.now())
  }, [activeQuestion, doubleTapTeamId, buzzWindowTs])

  // Timer countdown
  useEffect(() => {
    if (!timerPayload) { setTimeRemaining(null); return }

    const tick = () => {
      const remaining = Math.max(0, Math.floor(
        (timerPayload.start_timestamp + timerPayload.duration_seconds * 1000 - Date.now()) / 1000
      ))
      setTimeRemaining(remaining)

      if (remaining === 0) {
        clearInterval(id)
      }
    }

    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [timerPayload])

  // Double Tap: auto-buzz + local timer for the selecting team (no manual buzz needed)
  useEffect(() => {
    if (!activeQuestion || !doubleTapTeamId || doubleTapTeamId !== myTeam?.id) return
    if (dtAutoBuzzedRef.current === activeQuestion.id) return // already fired for this question
    dtAutoBuzzedRef.current = activeQuestion.id
    const qId  = activeQuestion.id
    const team = myTeamRef.current
    if (!team) return
    ;(async () => {
      const { data: buzz } = await supabase
        .from('buzzes')
        .insert({ question_id: qId, team_id: team.id, status: 'pending' })
        .select().single()
      if (!buzz) return
      setMyBuzzId(buzz.id)
      setHasBuzzed(true)
      // Set timer locally so the answer box appears immediately without waiting for host broadcast
      setTimerPayload({
        start_timestamp: Date.now(),
        duration_seconds: 40,
        team_id: team.id,
        buzz_id: buzz.id,
        team_name: team.name,
      })
    })()
  }, [activeQuestion, doubleTapTeamId, myTeam?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

    const pgCh = supabase
      .channel(`play-teams-${roomId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${roomId}` },
        refreshTeams)
      .subscribe()

    const roomCh = ablyClient.channels.get(`room:${roomId}`)
    roomCh.subscribe('team_joined', refreshTeams)
    roomCh.subscribe('lobby_closed', () => {
      clearPlayerSession()
      setRoom(null); setMyTeam(null); setTeams([])
      setPhase('no_lobby')
    })

    lobbyChannelRef.current = roomCh

    return () => {
      supabase.removeChannel(pgCh)
      roomCh.unsubscribe()
      lobbyChannelRef.current = null
    }
  }, [phase, room?.id])

  // Subscribe to teammate joins/leaves (lobby only)
  useEffect(() => {
    if (phase !== 'lobby' || !myTeam) return
    const ch = supabase.channel(`play-team-${myTeam.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'players', filter: `team_id=eq.${myTeam.id}` },
        () => fetchTeammates(myTeam.id))
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'players' },
        () => fetchTeammates(myTeam.id))
      .subscribe()
    teamChannelRef.current = ch
    return () => { supabase.removeChannel(ch); teamChannelRef.current = null }
  }, [phase, myTeam, fetchTeammates])

  // Trigger overlay expansion after previewInfo is painted
  useEffect(() => {
    if (!previewInfo) { setOverlayExpanding(false); return }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOverlayExpanding(true)))
    return () => cancelAnimationFrame(id)
  }, [previewInfo])

  // ── Actions ───────────────────────────────────────────────

  async function handleJoinLobby() {
    if (!room) return
    const { data: teamData } = await supabase
      .from('teams').select().eq('room_id', room.id).order('created_at', { ascending: true })
    setTeams(teamData ?? [])
    setPhase('select_team')
  }

  async function handleLeave() {
    await supabase.from('players').delete({ count: 'exact' }).eq('session_id', getSessionId())
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
    if (room?.id) await refreshAllScores(room.id)

    lobbyChannelRef.current?.publish('team_joined', {})
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

  async function handleSubmitBuzz() {
    if (!myTeam || !room?.current_question_id || hasBuzzed || buzzing) return
    setBuzzing(true)
    const qId = room.current_question_id
    const { data: buzz, error: err } = await supabase
      .from('buzzes')
      .insert({
        question_id: qId,
        team_id: myTeam.id,
        status: 'pending',
      })
      .select().single()
    if (!buzz || err) { setBuzzing(false); return }
    // Count buzzes at or before ours to get queue position
    const { count } = await supabase
      .from('buzzes')
      .select('*', { count: 'exact', head: true })
      .eq('question_id', qId)
      .lte('buzzed_at', buzz.buzzed_at)
    setMyBuzzId(buzz.id)
    setHasBuzzed(true)
    setBuzzPosition(count)
    setBuzzing(false)
    // Start 10s answer timer locally and broadcast for projector
    const startTs = Date.now()
    const payload: TimerPayload = {
      start_timestamp: startTs,
      duration_seconds: 15,
      team_id: myTeam.id,
      buzz_id: buzz.id,
      team_name: myTeam.name,
    }
    setTimerPayload(payload)
    broadcastRef.current?.publish('timer_start', payload)
  }

  function handleBuzzSubmitClick(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const id = Date.now()
    setRipples(prev => [...prev, { id, x, y }])
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 900)
    playBuzz()
    navigator.vibrate?.(100)
    handleSubmitBuzz()
  }

  async function handleSubmitResponse() {
    const buzzId = myBuzzId ?? timerPayload?.buzz_id
    if (!buzzId || !responseText.trim()) return
    responseSubmittedRef.current = true // guard before await to prevent race
    await supabase.from('buzzes').update({
      response: responseText.trim(),
      response_submitted_at: new Date().toISOString(),
    }).eq('id', buzzId)
    setResponseSubmitted(true)
    broadcastRef.current?.publish('team_answer_submitted', {
      team_id: myTeam?.id,
      buzz_id: buzzId,
      buzzPosition,
      response: responseText.trim(),
    })
  }

  function handleSelectQuestion(questionId: string, el: HTMLElement) {
    if (!room || (currentTurnTeamId !== null && myTeam?.id !== currentTurnTeamId)) return
    const cat = boardCategories.find(c => c.questions.some(q => q.id === questionId))
    const q   = cat?.questions.find(q => q.id === questionId)

    if (q?.is_double_tap) {
      // Fire question_preview immediately so all observers see the DT reveal at tile-tap time.
      // A second question_preview with the real wager fires after wager is confirmed.
      const team = myTeamRef.current
      if (team) {
        broadcastRef.current?.publish('question_preview', {
          questionId,
          categoryName: cat?.name ?? '',
          pointValue: q.point_value ?? null,
          startTs: Date.now(),
          selectorTeamId: team.id,
          doubleTapPending: true,
        })
      }
      const rect = el.getBoundingClientRect()
      setDoubleTapPendingQ({ questionId, rect })
      setDoubleTapWagerInput('')
      setDoubleTapStep('reveal')
      playDoubleTap()
      navigator.vibrate?.(200)
      setTimeout(() => setDoubleTapStep('wager'), 2000)
      return
    }

    _fireQuestionSelect(questionId, el, null)
  }

  function _fireQuestionSelect(questionId: string, elOrRect: HTMLElement | DOMRect, wager: number | null) {
    const cat = boardCategories.find(c => c.questions.some(q => q.id === questionId))
    const q   = cat?.questions.find(q => q.id === questionId)
    const preview: PreviewInfo = {
      questionId,
      categoryName: cat?.name ?? '',
      pointValue:   q?.point_value ?? null,
      startTs:      Date.now(),
      ...(wager !== null ? { doubleTapWager: wager } : {}),
    }
    const rect = elOrRect instanceof HTMLElement ? elOrRect.getBoundingClientRect() : elOrRect
    setTileRect(rect)
    broadcastRef.current?.publish('question_preview', {
      ...preview,
      ...(wager !== null && myTeam ? { selectorTeamId: myTeam.id } : {}),
    })
    setFlippingId(questionId)
    setTimeout(() => setPreviewInfo(preview), 600)
    setTimeout(() => setFlippingId(null), 650)
  }

  function handleConfirmDoubleTapWager() {
    if (!doubleTapPendingQ) return
    const roundFloor = room?.status === 'round_2' ? 2000 : 500
    const max    = Math.max(myScore, roundFloor)
    const parsed = parseInt(doubleTapWagerInput)
    const wager  = Math.max(5, Math.min(max, isNaN(parsed) ? 5 : parsed))
    const { questionId, rect } = doubleTapPendingQ
    setDoubleTapStep(null)
    setDoubleTapPendingQ(null)
    // Brief board flash, then overlay opens
    setTileRect(rect)
    _fireQuestionSelect(questionId, rect, wager)
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
    broadcastRef.current?.publish('fj_wager_locked', { team_id: myTeam.id })
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

  // ── Derived ───────────────────────────────────────────────

  const isMyTurnNow  = myTeam?.id === currentTurnTeamId
  const turnTeamName = currentTurnTeamId ? teamNames.get(currentTurnTeamId) : null

  // ── Score chip ────────────────────────────────────────────

  const scoreChip = (
    <button
      onClick={() => setShowScoreOverlay(true)}
      className={`absolute top-4 right-4 bg-gray-900 border border-gray-800 rounded-2xl px-3 py-2 text-right z-10 ${scoreChipPulse ? 'score-chip-pulse' : ''}`}
    >
      {myTeam && (
        <p className="text-gray-500 text-xs leading-tight truncate max-w-[6rem]">{myTeam.name}</p>
      )}
      <p className="text-yellow-400 font-mono font-black text-sm tabular-nums leading-tight">
        <AnimatedScore value={myScore} /> pts
      </p>
      <p className="text-gray-700 text-xs leading-tight">all scores ›</p>
    </button>
  )

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
        <QuipCycler />
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
        <input
          type="text"
          placeholder="Your nickname"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && nickname.trim() && handleJoinLobby()}
          className="w-full max-w-sm bg-gray-800 text-white rounded-xl px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-yellow-400 text-center text-lg"
          autoFocus
        />
        <button
          onClick={handleJoinLobby}
          disabled={!nickname.trim()}
          className="w-full max-w-sm py-4 rounded-2xl text-xl font-black bg-yellow-400 text-gray-950 disabled:opacity-30"
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
          {!showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              className="w-full border-2 border-yellow-400 text-yellow-400 rounded-xl px-4 py-3 font-bold mb-6"
            >
              + Create New Team
            </button>
          ) : (
            <div className="space-y-2 mb-6">
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
          {teams.length > 0 && (
            <>
              <p className="text-yellow-400 text-sm uppercase tracking-wider font-black mb-3">Join a team</p>
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
        <button onClick={handleLeave} className="mt-8 px-5 py-2 text-sm font-medium text-yellow-400 border border-yellow-500 rounded-lg hover:bg-yellow-500 hover:text-black transition-colors">
          Leave Team
        </button>
        <QuipCycler />
      </div>
    )
  }

  // ── Game phase ────────────────────────────────────────────

  // Score overlay
  const scoreOverlayEl = showScoreOverlay ? (
    <ScoreOverlay
      teams={allTeamScores.length > 0 ? allTeamScores : (myTeam ? [{ id: myTeam.id, name: myTeam.name, score: myScore }] : [])}
      myTeamId={myTeam?.id}
      onClose={() => setShowScoreOverlay(false)}
    />
  ) : null

  // ── Final Jeopardy screens ────────────────────────────────

  if (fjSubPhase === 'incoming') {
    return (
      <div className="min-h-screen bg-blue-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <p className="text-6xl mb-6">🍺</p>
        <p className="text-blue-400 text-xs uppercase tracking-widest mb-3">Final Tap</p>
        <p className="text-3xl font-black text-white mb-4">Starting Soon!</p>
        {fjCategoryName && (
          <div className="mb-4">
            <p className="text-gray-500 text-xs uppercase tracking-widest mb-1">Category</p>
            <p className="text-yellow-300 text-2xl font-black">{fjCategoryName}</p>
          </div>
        )}
        <p className="text-gray-300 text-lg leading-relaxed max-w-xs">
          Get a drink and discuss with your team!
        </p>
        <div className="mt-10 flex gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <QuipCycler />
      </div>
    )
  }

  if (fjSubPhase === 'wager') {
    const maxWager = Math.max(0, myScore)
    const wagerVal = Math.max(0, Math.min(maxWager, parseInt(fjWagerInput) || 0))
    const valid    = fjWagerInput !== '' && wagerVal >= 0
    return (
      <div className="min-h-screen bg-blue-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
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
        {scoreOverlayEl}
        {scoreChip}
        <div className="w-3 h-3 rounded-full bg-green-400 mb-6 animate-pulse" />
        <p className="text-2xl font-black text-white mb-2">Wager locked in</p>
        <p className="text-gray-400 text-sm">Waiting for other teams…</p>
        <p className="text-blue-400 text-xs uppercase tracking-widest mt-10">{fjCategoryName}</p>
        <QuipCycler />
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
        {scoreOverlayEl}
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
        {scoreOverlayEl}
        {scoreChip}
        <div className="w-3 h-3 rounded-full bg-gray-600 mb-6 animate-pulse" />
        <p className="text-2xl font-black text-white mb-2">Time's up!</p>
        <p className="text-gray-500 text-sm">The host is reviewing answers…</p>
        <QuipCycler />
      </div>
    )
  }

  if (fjSubPhase === 'done') {
    const winner = [...fjFinalScores].sort((a, b) => b.score - a.score)[0]
    const myEntry = fjFinalScores.find(t => t.id === myTeam?.id)
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
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
        <button onClick={handleLeave} className="mt-6 px-5 py-2 text-sm font-medium text-yellow-400 border border-yellow-500 rounded-lg hover:bg-yellow-500 hover:text-black transition-colors">
          Leave
        </button>
      </div>
    )
  }

  // ── Check buzzResult FIRST so feedback persists after question is cleared ──

  if (buzzResult === 'correct') {
    return (
      <div className="relative min-h-screen bg-green-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        <Confetti active={showConfetti} onDone={() => setShowConfetti(false)} />
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
        {scoreOverlayEl}
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

  // ── Double Tap reveal screens ─────────────────────────────

  if (doubleTapStep === 'reveal') {
    return (
      <div className="min-h-screen bg-amber-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div style={{ animation: 'double-tap-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
          <p className="text-8xl mb-4">🍺</p>
          <p className="text-5xl font-black text-amber-400 leading-none mb-2">DOUBLE TAP!</p>
          <p className="text-amber-200 text-xl font-semibold">Get ready to wager!</p>
        </div>
      </div>
    )
  }

  // Other players see the DT reveal animation too, but locked out
  if (dtRevealForObserver) {
    const dtName = doubleTapTeamId ? (teamNames.get(doubleTapTeamId) ?? 'Another team') : 'Another team'
    return (
      <div className="min-h-screen bg-amber-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreChip}
        <div style={{ animation: 'double-tap-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
          <p className="text-8xl mb-4">🍺</p>
          <p className="text-5xl font-black text-amber-400 leading-none mb-2">DOUBLE TAP!</p>
          <p className="text-amber-200 text-xl font-semibold">{dtName} is wagering!</p>
        </div>
      </div>
    )
  }

  if (doubleTapStep === 'wager' && doubleTapPendingQ) {
    const roundFloor = room?.status === 'round_2' ? 2000 : 500
    const maxWager = Math.max(myScore, roundFloor)
    const parsed   = parseInt(doubleTapWagerInput)
    const wagerVal = isNaN(parsed) ? 5 : Math.max(5, Math.min(maxWager, parsed))
    const valid    = doubleTapWagerInput !== '' && !isNaN(parsed) && parsed >= 5 && parsed <= maxWager
    return (
      <div className="min-h-screen bg-amber-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreChip}
        <p className="text-5xl mb-4">🍺</p>
        <p className="text-3xl font-black text-amber-400 mb-1">DOUBLE TAP!</p>
        <p className="text-gray-400 text-sm mb-8">Min: $5 — Max: ${maxWager.toLocaleString()}</p>
        <div className="w-full max-w-xs space-y-4">
          <input
            type="number"
            inputMode="numeric"
            autoFocus
            min={5}
            max={maxWager}
            placeholder="5"
            value={doubleTapWagerInput}
            onChange={e => setDoubleTapWagerInput(e.target.value)}
            className="w-full bg-gray-800 text-white text-center text-5xl font-mono font-black rounded-2xl px-4 py-5 outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            onClick={handleConfirmDoubleTapWager}
            disabled={!valid}
            className="w-full py-4 rounded-2xl text-lg font-black bg-amber-400 text-gray-950 disabled:opacity-30"
          >
            Lock In: {wagerVal} pts
          </button>
        </div>
      </div>
    )
  }

  // ── No active question — show board ───────────────────────

  if (!activeQuestion) {
    const pointValues = [...new Set(
      boardCategories.flatMap(c => c.questions.map(q => q.point_value ?? 0)).filter(Boolean)
    )].sort((a, b) => a - b)

    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        {scoreOverlayEl}
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
                    style={{ fontSize: 'clamp(0.65rem, 3vw, 0.9rem)' }}>
                    {cat.name}
                  </p>
                </div>
              ))}
              {pointValues.flatMap(pv =>
                boardCategories.map(cat => {
                  const q = cat.questions.find(q => q.point_value === pv)
                  if (!q) return <div key={`${cat.id}-${pv}`} className="h-20 rounded bg-gray-900/20" />
                  const answered   = q.is_answered
                  const isFlipping = flippingId === q.id

                  if (isFlipping) {
                    return (
                      <div key={q.id} className="h-20 rounded"
                        style={{ perspective: '600px', filter: 'drop-shadow(0 6px 20px rgba(0,0,0,0.7))' }}>
                        <div className="relative h-full w-full"
                          style={{ transformStyle: 'preserve-3d', animation: 'card-flip 0.6s ease-in-out forwards' }}>
                          <div className="absolute inset-0 rounded flex items-center justify-center font-mono font-black text-yellow-400"
                            style={{
                              backfaceVisibility: 'hidden',
                              fontSize: 'clamp(1rem, 4vw, 1.4rem)',
                              background: 'linear-gradient(145deg, #2563eb 0%, #1e40af 60%, #1a3899 100%)',
                              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
                            }}>
                            ${pv}
                          </div>
                          <div className="absolute inset-0 rounded flex items-center justify-center p-1 text-center"
                            style={{
                              backfaceVisibility: 'hidden',
                              transform: 'rotateY(180deg)',
                              background: 'linear-gradient(145deg, #1e3a8a 0%, #172554 60%, #0f1c46 100%)',
                            }}>
                            <p className="font-black uppercase text-white leading-tight"
                              style={{ fontSize: 'clamp(0.55rem, 2.5vw, 0.75rem)' }}>
                              {cat.name}
                            </p>
                          </div>
                          <div style={{ position: 'absolute', top: 0, left: '100%', width: '4px', height: '100%', background: '#0a153a', transform: 'rotateY(90deg)', transformOrigin: 'left center' }} />
                          <div style={{ position: 'absolute', top: 0, right: '100%', width: '4px', height: '100%', background: '#0a153a', transform: 'rotateY(-90deg)', transformOrigin: 'right center' }} />
                        </div>
                      </div>
                    )
                  }

                  return (
                    <button
                      key={q.id}
                      onClick={(e) => isMyTurnNow && !answered && handleSelectQuestion(q.id, e.currentTarget)}
                      disabled={answered || !isMyTurnNow}
                      className={`h-20 rounded font-mono font-black transition-colors relative overflow-hidden ${
                        answered
                          ? 'bg-gray-900/30 text-gray-800 cursor-default'
                          : isMyTurnNow
                            ? 'bg-blue-800 hover:bg-blue-700 active:bg-blue-600 text-yellow-400'
                            : 'bg-blue-900/60 text-blue-400 cursor-default'
                      }`}
                      style={{ fontSize: 'clamp(1rem, 4vw, 1.4rem)' }}
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
          className="shrink-0 py-3 text-sm font-medium text-yellow-400 border border-yellow-500 rounded-lg hover:bg-yellow-500 hover:text-black transition-colors text-center w-full">
          Leave Team
        </button>

        {/* Preview overlay */}
        {previewInfo && (
          <div className="fixed inset-0 z-50 bg-blue-950 text-white flex flex-col items-center justify-center p-6 text-center"
            style={tileRect ? (() => {
              const vw = window.innerWidth, vh = window.innerHeight
              const scaleX = tileRect.width  / vw
              const scaleY = tileRect.height / vh
              const dx = tileRect.left + tileRect.width  / 2 - vw / 2
              const dy = tileRect.top  + tileRect.height / 2 - vh / 2
              return {
                transform: overlayExpanding
                  ? 'none'
                  : `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`,
                transition: overlayExpanding
                  ? 'transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94), border-radius 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
                  : 'none',
                transformOrigin: 'center center',
                borderRadius: overlayExpanding
                  ? '0px'
                  : `${(8 / scaleX).toFixed(1)}px / ${(8 / scaleY).toFixed(1)}px`,
                overflow: 'hidden',
              }
            })() : undefined}>
            {scoreChip}
            {previewInfo.doubleTapWager !== undefined && (
              <div className="mb-4 px-4 py-2 bg-amber-500/20 border border-amber-500/40 rounded-xl">
                <p className="text-amber-400 font-black text-sm">🍺 DOUBLE TAP! — {previewInfo.doubleTapWager} pts wagered</p>
              </div>
            )}
            <p className="text-blue-400 text-xs uppercase tracking-widest mb-6">Category</p>
            <p className="font-black text-white leading-tight mb-3"
              style={{ fontSize: 'clamp(1.75rem, 7vw, 3rem)' }}>
              {previewInfo.categoryName}
            </p>
            {previewInfo.pointValue != null && !previewInfo.doubleTapWager && (
              <p className="text-yellow-400 font-mono font-black text-3xl mb-8">
                ${previewInfo.pointValue}
              </p>
            )}
            <p className="text-gray-500 text-sm animate-pulse">Waiting for host…</p>
            <QuipCycler />
          </div>
        )}
      </div>
    )
  }

  // ── Active question ───────────────────────────────────────

  const isDt = doubleTapTeamId !== null && doubleTapTeamId === myTeam?.id

  // DT answer phase: auto-buzzed team types response with 40s timer
  if (hasBuzzed && !responseSubmitted && isDt) {
    const dtTimer    = timeRemaining ?? 40
    const dtTimerPct = (dtTimer / 40) * 100
    const dtTimerLow = dtTimer <= 10
    return (
      <div className="relative min-h-screen bg-gray-950 text-white flex flex-col p-6">
        {scoreOverlayEl}
        {scoreChip}
        <div className="max-w-sm mx-auto w-full flex flex-col flex-1 pt-8">
          <div className="flex items-center justify-between mb-2">
            <p className="text-yellow-400 font-black text-xl">Your turn!</p>
            <span className={`font-mono text-4xl font-black tabular-nums ${dtTimerLow ? 'text-red-400' : 'text-white'}`}>
              {dtTimer}
            </span>
          </div>

          <div className="w-full h-2 bg-gray-800 rounded-full mb-6 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${dtTimerLow ? 'bg-red-500' : 'bg-yellow-400'}`}
              style={{ width: `${dtTimerPct}%` }}
            />
          </div>

          <div className="bg-gray-900 rounded-2xl p-4 mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">The answer</p>
            <p className="text-lg font-bold leading-snug">{activeQuestion.answer}</p>
          </div>

          {dtTimer === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
              <p className="text-red-400 font-black text-3xl mb-2">Time's up!</p>
              <p className="text-gray-500 text-sm">You didn't answer in time.</p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    )
  }

  // Non-DT answer phase: this team buzzed (me or a teammate), now has 10s to type response
  if (timerPayload?.team_id === myTeam?.id && !responseSubmitted && !isDt) {
    const ansTimer    = timeRemaining ?? 15
    const ansTimerPct = (ansTimer / 15) * 100
    const ansTimerLow = ansTimer <= 3
    return (
      <div className="relative min-h-screen bg-gray-950 text-white flex flex-col p-6">
        {scoreOverlayEl}
        {scoreChip}
        <div className="max-w-sm mx-auto w-full flex flex-col flex-1 pt-8">
          <div className="flex items-center justify-between mb-2">
            <p className="text-yellow-400 font-black text-xl">{hasBuzzed ? "You're in! Type fast!" : 'Teammate buzzed! Type fast!'}</p>
            <span className={`font-mono text-4xl font-black tabular-nums ${ansTimerLow ? 'text-red-400' : 'text-white'}`}>
              {ansTimer}
            </span>
          </div>

          <div className="w-full h-2 bg-gray-800 rounded-full mb-4 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${ansTimerLow ? 'bg-red-500' : 'bg-yellow-400'}`}
              style={{ width: `${ansTimerPct}%` }}
            />
          </div>

          <div className="bg-gray-900 rounded-2xl p-4 mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">The answer</p>
            <p className="text-lg font-bold leading-snug">{activeQuestion.answer}</p>
          </div>

          {ansTimer === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
              <p className="text-red-400 font-black text-3xl mb-2">Time's up!</p>
              <p className="text-gray-500 text-sm">You didn't answer in time.</p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    )
  }

  // Response submitted — waiting for host judgment
  if (timerPayload?.team_id === myTeam?.id && responseSubmitted) {
    const posLabel = buzzPosition === 1 ? '1st' : buzzPosition === 2 ? '2nd' : buzzPosition === 3 ? '3rd' : `${buzzPosition ?? '?'}th`
    return (
      <div className="relative min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <div className="w-3 h-3 rounded-full bg-yellow-400 mb-6 animate-pulse" />
        {buzzPosition !== null ? (
          <>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">You're</p>
            <p className="text-7xl font-black text-yellow-400 tabular-nums leading-none mb-1">{posLabel}</p>
            <p className="text-gray-400 text-lg mb-6">in the queue</p>
          </>
        ) : (
          <p className="text-2xl font-black text-white mb-6">Buzzed in!</p>
        )}
        {responseText ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-4 max-w-xs">
            <p className="text-gray-300 italic">"{responseText}"</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-4 max-w-xs">
            <p className="text-gray-600 italic text-sm">No response submitted</p>
          </div>
        )}
        <p className="text-gray-600 text-xs mt-6">Waiting for the host…</p>
      </div>
    )
  }

  // Buzzed or submitted — never show buzz button again until question is cleared
  // hasBuzzed covers: buzzed but timer expired before submission, then host judges wrong (clears timerPayload)
  // responseSubmitted covers: teammates who submitted via team_answer_submitted broadcast
  if (hasBuzzed || responseSubmitted) {
    return (
      <div className="relative min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <div className="w-3 h-3 rounded-full bg-yellow-400 mb-6 animate-pulse" />
        <p className="text-2xl font-black text-white mb-2">
          {responseSubmitted ? 'Response submitted' : 'Buzzed in!'}
        </p>
        <p className="text-gray-500 text-sm">Waiting for the host…</p>
        {responseText && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-4 max-w-xs mt-6">
            <p className="text-gray-300 italic">"{responseText}"</p>
          </div>
        )}
      </div>
    )
  }

  // Double Tap — locked out (another team's exclusive question)
  if (doubleTapTeamId && doubleTapTeamId !== myTeam?.id) {
    const dtTeamName = teamNames.get(doubleTapTeamId) ?? 'Another team'
    return (
      <div className="relative min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <div className="text-5xl mb-6">🍺</div>
        <p className="text-2xl font-black text-amber-400 mb-2">Double Tap!</p>
        <p className="text-gray-400 text-lg mb-6">{dtTeamName} is answering</p>
        <div className="bg-gray-900 rounded-2xl p-5 max-w-sm w-full">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">The answer</p>
          <p className="text-xl font-bold leading-snug">{activeQuestion.answer}</p>
        </div>
      </div>
    )
  }

  // Active question — buzz phase (question visible, waiting for buzz)
  return (
    <div className="relative min-h-screen bg-gray-950 text-white flex flex-col p-5">
      {scoreOverlayEl}
      {scoreChip}
      <div className="max-w-sm mx-auto w-full flex flex-col" style={{ minHeight: 'calc(100vh - 2.5rem)' }}>
        <div className="bg-gray-900 rounded-2xl p-5 mb-6 pt-14">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">The answer</p>
          <p className="text-2xl font-bold leading-snug">{activeQuestion.answer}</p>
          {activeQuestion.point_value && (
            <p className="text-yellow-400 font-mono text-sm mt-3 font-semibold">{activeQuestion.point_value} pts</p>
          )}
        </div>
        <div className="flex-1 flex flex-col justify-end pb-4">
          <button
            onClick={handleBuzzSubmitClick}
            disabled={buzzing}
            className="relative overflow-hidden w-full py-8 rounded-2xl font-black text-2xl bg-red-600 hover:bg-red-500 active:bg-red-700 disabled:bg-red-900 text-white transition-colors shadow-[0_0_40px_rgba(220,38,38,0.5)]"
          >
            {ripples.map(r => (
              <span
                key={r.id}
                className="absolute rounded-full bg-white pointer-events-none"
                style={{
                  left: r.x - 24,
                  top: r.y - 24,
                  width: 48,
                  height: 48,
                  animation: 'buzz-ripple 0.9s ease-out forwards',
                }}
              />
            ))}
            {buzzing ? '…' : 'BUZZ!'}
          </button>
        </div>
      </div>
    </div>
  )
}
