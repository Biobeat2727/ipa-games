import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ablyClient, serverNow } from '../../lib/ably'
import type { Buzz, QuestionPublic, Room, ScoreSnapshot, Team } from '../../lib/types'
import AnimatedScore from '../../components/AnimatedScore'
import Confetti from '../../components/Confetti'
import { playRoundTransition } from '../../lib/sounds'
import ScoreHistoryChart, { getTeamColor } from '../../components/ScoreHistoryChart'
import { BeerGlass, TapHeader } from '../../components/TapCategoryColumn'
import { Bubbles, PintHero } from '../../components/Barware'
import { findCurrentActiveRoom } from '../../lib/roomDiscovery'

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
  questions: QuestionPublic[]
}

type Phase = 'checking' | 'waiting' | 'connected'

export default function ProjectorView() {
  const [phase, setPhase]               = useState<Phase>('checking')
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

  // Projector overlay states
  const [roundSplash, setRoundSplash]           = useState<string | null>(null)
  const [doubleTapSplash, setDoubleTapSplash]   = useState(false)
  const [scoreDeltas, setScoreDeltas]           = useState<Array<{ id: string; teamId: string; delta: number }>>([])

  // Round intermission
  const [intermissionSnapshots, setIntermissionSnapshots] = useState<ScoreSnapshot[] | null>(null)

  // Winner celebration confetti (fires a few bursts when the game ends)
  const [confettiActive, setConfettiActive] = useState(false)
  const confettiBurstsRef = useRef(0)

  // Final Jeopardy state
  const [fjCategoryName, setFjCategoryName]   = useState('')
  const [fjQuestion, setFjQuestion]           = useState<{ answer: string } | null>(null)
  const [fjWagerStatus, setFjWagerStatus]     = useState<Set<string>>(new Set())
  const [fjResponseDeadline, setFjResponseDeadline] = useState<number | null>(null)
  const [fjTimeRemaining, setFjTimeRemaining] = useState<number | null>(null)
  const [fjReveal, setFjReveal]               = useState<{
    teamName: string; response: string | null; result?: 'correct' | 'wrong'; wager?: number; newScore?: number
  } | null>(null)

  // Refs — give stable callbacks access to latest values without re-creating them
  const roomRef            = useRef<Room | null>(null)
  const teamsRef           = useRef<Team[]>([])
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const doubleTapPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      .from('questions_public').select().in('category_id', roundCats.map(c => c.id))

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
    } else if (freshRoom.status === 'final_jeopardy') {
      const [{ data: category }, { data: wagers }] = await Promise.all([
        supabase.from('categories').select('name').eq('room_id', roomId).eq('round', 3).single(),
        supabase.from('wagers').select().eq('room_id', roomId),
      ])
      setFjCategoryName(category?.name ?? 'Final Tap')
      setFjWagerStatus(new Set((wagers ?? []).map(w => w.team_id)))

      if (freshRoom.final_phase === 'question'
        && freshRoom.final_question_id
        && freshRoom.final_response_deadline_at) {
        const { data: question } = await supabase
          .from('questions_public')
          .select('answer')
          .eq('id', freshRoom.final_question_id)
          .single()
        const deadline = new Date(freshRoom.final_response_deadline_at).getTime()
        setFjReveal(null)
        setFjQuestion(question ?? null)
        setFjResponseDeadline(deadline)
        setFjTimeRemaining(Math.max(0, Math.floor((deadline - serverNow()) / 1000)))
      } else if (freshRoom.final_phase === 'review' && freshRoom.final_review_team_id) {
        const reviewTeam = list.find(t => t.id === freshRoom.final_review_team_id)
        const reviewWager = (wagers ?? []).find(w => w.team_id === freshRoom.final_review_team_id)
        setFjQuestion(null)
        setFjResponseDeadline(null)
        setFjTimeRemaining(0)
        setFjReveal(reviewTeam ? {
          teamName: reviewTeam.name,
          response: reviewWager?.response ?? null,
          ...(reviewWager?.status === 'correct' || reviewWager?.status === 'wrong'
            ? {
                result: reviewWager.status,
                wager: reviewWager.amount,
                newScore: reviewTeam.score,
              }
            : {}),
        } : null)
      } else {
        setFjQuestion(null)
        setFjReveal(null)
        setFjResponseDeadline(null)
        setFjTimeRemaining(null)
      }
    }
  }, [loadCategories])

  // ── Auto-resolve + polling ────────────────────────────────

  useEffect(() => {
    async function init() {
      try {
        const found = await findCurrentActiveRoom()
        if (found) {
          roomRef.current = found
          setRoom(found)
          const { data } = await supabase
            .from('teams').select().eq('room_id', found.id).order('score', { ascending: false })
          const list = data ?? []
          setTeams(list)
          setScores(new Map(list.map(t => [t.id, t.score])))
          if (['round_1', 'round_2'].includes(found.status)) {
            await loadCategories(found.id, found.status)
          }
          setPhase('connected')
        } else {
          setPhase('waiting')
        }
      } catch {
        setPhase('waiting')
      }
    }
    init()
  }, [loadCategories])

  // Poll every 3s while waiting for a room to appear
  useEffect(() => {
    if (phase !== 'waiting') return
    const id = setInterval(async () => {
      try {
        const found = await findCurrentActiveRoom()
        if (found) {
          roomRef.current = found
          setRoom(found)
          const { data } = await supabase
            .from('teams').select().eq('room_id', found.id).order('score', { ascending: false })
          const list = data ?? []
          setTeams(list)
          setScores(new Map(list.map(t => [t.id, t.score])))
          if (['round_1', 'round_2'].includes(found.status)) {
            await loadCategories(found.id, found.status)
          }
          setPhase('connected')
        }
      } catch { /* keep polling through transient connection errors */ }
    }, 3000)
    return () => clearInterval(id)
  }, [phase, loadCategories])

  // ── DB Subscriptions ─────────────────────────────────────

  useEffect(() => {
    if (!room?.id) return
    const roomId = room.id

    const ch = supabase.channel(`projector-db-${roomId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        async payload => {
          const updated = payload.new as Room
          roomRef.current = updated
          setRoom(updated)
          if (['round_1', 'round_2'].includes(updated.status)) {
            await loadCategories(roomId, updated.status)
          } else if (updated.status === 'final_jeopardy') {
            await resyncAll()
          }
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${roomId}` },
        refetchTeams)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') resyncAll()
      })

    return () => { supabase.removeChannel(ch) }
  }, [room?.id, loadCategories, refetchTeams, resyncAll])

  // ── Broadcast channel ─────────────────────────────────────

  useEffect(() => {
    if (!room?.id) return
    const ch = ablyClient.channels.get(`room:${room.id}`)

    ch.subscribe('question_preview', ({ data }) => {
      const p = data as { questionId: string; categoryName: string; pointValue: number | null; startTs: number; doubleTapWager?: number; doubleTapPending?: boolean }
      if (p.doubleTapPending) {
        // Immediate DT notification at tile-tap — show the splash right away
        setDoubleTapSplash(true)
        return
      }
      if (p.doubleTapWager !== undefined) {
        // Real DT preview (post-wager) — splash may already be showing; keep it 2s then show preview
        setDoubleTapSplash(true)
        if (doubleTapPreviewTimerRef.current) clearTimeout(doubleTapPreviewTimerRef.current)
        doubleTapPreviewTimerRef.current = setTimeout(() => {
          setDoubleTapSplash(false)
          setPreviewInfo(p)
        }, 2000)
      } else {
        setPreviewInfo(p)
      }
    })
    ch.subscribe('question_activated', ({ data }) => {
      const { question_id } = data as { question_id: string }
      if (doubleTapPreviewTimerRef.current) clearTimeout(doubleTapPreviewTimerRef.current)
      setPreviewInfo(null)
      setDoubleTapSplash(false)
      setRoom(prev => prev ? { ...prev, current_question_id: question_id } : prev)
      setTimerPayload(null)
    })
    ch.subscribe('question_deactivated', () => {
      if (doubleTapPreviewTimerRef.current) clearTimeout(doubleTapPreviewTimerRef.current)
      setPreviewInfo(null)
      setDoubleTapSplash(false)
      setRoom(prev => prev ? { ...prev, current_question_id: null } : prev)
      setTimerPayload(null)
    })
    ch.subscribe('question_selection_cleared', () => {
      if (doubleTapPreviewTimerRef.current) clearTimeout(doubleTapPreviewTimerRef.current)
      setPreviewInfo(null)
      setDoubleTapSplash(false)
    })
    ch.subscribe('timer_start', ({ data }) => {
      setTimerPayload(data as TimerPayload)
    })
    ch.subscribe('score_update', ({ data: msg }) => {
      const upd = msg as {
        teams: Array<{ id: string; score: number }>
        current_question_id?: string | null
        answered_question_id?: string
        winning_team_id?: string
      }
      const newScoreMap = new Map(upd.teams.map(t => [t.id, t.score]))
      // Compute deltas for floating labels
      const deltas: Array<{ id: string; teamId: string; delta: number }> = []
      setScores(prev => {
        upd.teams.forEach(t => {
          const old = prev.get(t.id)
          if (old !== undefined && old !== t.score) {
            deltas.push({ id: `${t.id}-${Date.now()}`, teamId: t.id, delta: t.score - old })
          }
        })
        return newScoreMap
      })
      if (deltas.length > 0) {
        setScoreDeltas(prev => [...prev, ...deltas])
        setTimeout(() => {
          const ids = new Set(deltas.map(d => d.id))
          setScoreDeltas(prev => prev.filter(d => !ids.has(d.id)))
        }, 1300)
      }
      // Apply question state from the host payload — most reliable path since
      // score_update always arrives while postgres_changes can be missed.
      if ('current_question_id' in upd) {
        setRoom(prev => prev ? { ...prev, current_question_id: upd.current_question_id ?? null } : prev)
        if (!upd.current_question_id) setTimerPayload(null)
      }
      // Mark the answered question in local categories so the board cell greys out.
      if (upd.answered_question_id) {
        setCategories(prev => prev.map(cat => ({
          ...cat,
          questions: cat.questions.map(q =>
            q.id === upd.answered_question_id ? { ...q, is_answered: true } : q
          ),
        })))
      }
      // Correct-answer feedback comes from the authenticated host broadcast. The
      // projector intentionally cannot read the private questions table anymore.
      if (upd.winning_team_id) {
        const name = teamsRef.current.find(t => t.id === upd.winning_team_id)?.name ?? ''
        if (name) {
          setFeedbackTeam(name)
          if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
          feedbackTimeoutRef.current = setTimeout(() => setFeedbackTeam(null), 2500)
        }
      }
    })
    ch.subscribe('turn_change', ({ data }) => {
      const { team_id } = data as { team_id: string | null }
      setCurrentTurnTeamId(team_id)
    })
    ch.subscribe('round_intermission', ({ data }) => {
      const { snapshots } = data as { snapshots: ScoreSnapshot[] }
      setIntermissionSnapshots(snapshots)
      // Broadcast-only state — persist so a refresh restores the chart
      const r = roomRef.current
      if (r) sessionStorage.setItem('intermission', JSON.stringify({ roomId: r.id, status: r.status, snapshots }))
    })
    ch.subscribe('intermission_closed', () => {
      setIntermissionSnapshots(null)
      sessionStorage.removeItem('intermission')
    })
    // Fired by the host when the game starts — transition from lobby to board
    ch.subscribe('game_state_change', ({ data }) => {
      const { status, fj_category } = data as { status?: string; fj_category?: string }
      if (fj_category) setFjCategoryName(fj_category)
      if (status === 'round_2') {
        setIntermissionSnapshots(null)
        sessionStorage.removeItem('intermission')
        setRoundSplash('ROUND 2')
        playRoundTransition()
        setTimeout(() => setRoundSplash(null), 2500)
      }
      if (status === 'final_jeopardy') {
        setIntermissionSnapshots(null)
        sessionStorage.removeItem('intermission')
      }
      resyncAll()
    })
    // Fired by players when they join — keeps lobby team list in sync
    ch.subscribe('team_joined', () => refetchTeams())
    ch.subscribe('fj_wager_locked', ({ data }) => {
      const { team_id } = data as { team_id: string }
      setFjWagerStatus(prev => new Set([...prev, team_id]))
    })
    ch.subscribe('fj_question_revealed', async ({ data }) => {
      const { question_id, start_ts, response_deadline_at } = data as {
        question_id: string
        start_ts: number
        response_deadline_at?: number
      }
      const { data: q } = await supabase.from('questions_public').select().eq('id', question_id).single()
      if (q) setFjQuestion({ answer: q.answer })
      setFjResponseDeadline(response_deadline_at ?? start_ts + 90_000)
      setFjTimeRemaining(90)
    })
    ch.subscribe('fj_timer_expired', () => {
      setFjTimeRemaining(0)
    })
    ch.subscribe('fj_answer_reveal', ({ data }) => {
      const { team_name, response } = data as { team_name: string; response: string | null }
      setFjReveal({ teamName: team_name, response })
    })
    ch.subscribe('fj_answer_judged', ({ data }) => {
      const { team_id, status, wager, new_score } = data as {
        team_id: string; status: 'correct' | 'wrong'; wager: number; new_score: number
      }
      setFjReveal(prev => prev ? { ...prev, result: status, wager, newScore: new_score } : prev)
      setScores(prev => new Map([...prev, [team_id, new_score]]))
    })
    ch.subscribe('game_over', ({ data }) => {
      const { scores: s } = data as { scores: Array<{ id: string; score: number }> }
      setScores(new Map(s.map(t => [t.id, t.score])))
      setRoom(prev => prev ? { ...prev, status: 'finished' } : prev)
    })
    ch.subscribe('lobby_closed', () => {
      setRoom(null)
      setTeams([]); setCategories([]); setBuzzes([])
      setPhase('waiting')
    })
    // On (re)connect, re-sync all state so nothing is missed
    ch.on('attached', () => resyncAll())

    return () => { ch.unsubscribe() }
  }, [room?.id, refetchTeams, resyncAll])

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

  // ── FJ countdown ──────────────────────────────────────────

  useEffect(() => {
    if (fjResponseDeadline === null) return
    let id: ReturnType<typeof setInterval> | null = null
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((fjResponseDeadline - serverNow()) / 1000))
      setFjTimeRemaining(remaining)
      if (remaining === 0 && id) {
        clearInterval(id)
        id = null
      }
      return remaining
    }
    if (tick() > 0) id = setInterval(tick, 500)
    return () => { if (id) clearInterval(id) }
  }, [fjResponseDeadline])


  // ── Winner confetti ───────────────────────────────────────

  useEffect(() => {
    if (room?.status !== 'finished') return
    confettiBurstsRef.current = 0
    setConfettiActive(true)
  }, [room?.status])

  // Refresh survival for the score-map intermission (broadcast-only state): restore
  // the chart from sessionStorage as long as the room hasn't moved on.
  useEffect(() => {
    if (!room?.id || intermissionSnapshots) return
    const saved = sessionStorage.getItem('intermission')
    if (!saved) return
    try {
      const parsed = JSON.parse(saved) as { roomId: string; status: string; snapshots: ScoreSnapshot[] }
      if (parsed.roomId !== room.id || parsed.status !== room.status) {
        sessionStorage.removeItem('intermission')
        return
      }
      if (Array.isArray(parsed.snapshots) && parsed.snapshots.length > 0) {
        setIntermissionSnapshots(parsed.snapshots)
      }
    } catch {
      sessionStorage.removeItem('intermission')
    }
  }, [room?.id, room?.status, intermissionSnapshots])

  // ── Cleanup ───────────────────────────────────────────────

  useEffect(() => () => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
    if (doubleTapPreviewTimerRef.current) clearTimeout(doubleTapPreviewTimerRef.current)
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

  if (phase === 'checking') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400 text-2xl animate-pulse">Connecting…</p>
      </div>
    )
  }

  if (phase === 'waiting') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8 text-center">
        <h1 className="text-5xl font-black text-yellow-400 mb-4">Tapped In!</h1>
        <p className="text-gray-500 animate-pulse">Waiting for host to create a lobby…</p>
      </div>
    )
  }

  // At this point phase === 'connected' and room is guaranteed non-null
  if (!room) return null

  // Correct feedback flash
  if (feedbackTeam) {
    return (
      <div className="min-h-screen bg-green-900 text-white flex flex-col items-center justify-center text-center p-8">
        <p className="font-black text-green-300 leading-none mb-6"
          style={{ fontSize: 'min(20vw, 16rem)', animation: 'pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>✓</p>
        <p className="font-black text-green-200 mb-4"
          style={{ fontSize: 'clamp(3rem, 8vw, 7rem)', animation: 'slide-up-in 0.4s ease-out 0.15s both' }}>Correct!</p>
        <p className="font-bold text-white"
          style={{ fontSize: 'clamp(2rem, 6vw, 5rem)', animation: 'slide-up-in 0.4s ease-out 0.3s both' }}>{feedbackTeam}</p>
      </div>
    )
  }

  // Lobby — same bar mood as the phone join screens: warm dark, bubbles, neon sign
  if (room.status === 'lobby') {
    const joinUrl = window.location.origin
    return (
      <div className="h-screen bar-bg text-white flex flex-col items-center justify-center text-center relative overflow-hidden px-8"
        style={{ paddingTop: 'clamp(0.75rem, 2.5vh, 2rem)', paddingBottom: 'clamp(0.75rem, 2.5vh, 2rem)' }}>
        <Bubbles count={20} />
        {/* Every vertical size is vh-aware so the whole stack compresses to fit
            the screen — the projector must never scroll or clip */}
        <div className="relative z-10 flex flex-col items-center w-full min-h-0"
          style={{ gap: 'clamp(0.5rem, 1.8vh, 1.5rem)' }}>
          <h1 className="neon-title font-black tracking-tight"
            style={{ fontSize: 'clamp(2.25rem, min(8vw, 10vh), 7rem)', animation: 'slide-up-in 0.5s ease-out both' }}>
            Tapped In!
          </h1>
          <p className="text-amber-400/90 uppercase tracking-[0.4em]"
            style={{ fontSize: 'clamp(0.9rem, min(2vw, 2.6vh), 1.5rem)', animation: 'slide-up-in 0.5s ease-out 0.12s both' }}>
            Grab your phone — scan to join
          </p>
          <div className="glass-card rounded-3xl p-4"
            style={{ animation: 'slide-up-in 0.5s ease-out 0.24s both' }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(joinUrl)}&size=300x300`}
              alt="Scan to join"
              className="rounded-2xl bg-white p-3"
              style={{ width: 'clamp(120px, min(18vw, 32vh), 280px)', height: 'clamp(120px, min(18vw, 32vh), 280px)' }}
            />
          </div>
          <p className="font-semibold text-amber-100/90"
            style={{ fontSize: 'clamp(1rem, min(3vw, 3.2vh), 2.25rem)', animation: 'slide-up-in 0.5s ease-out 0.36s both' }}>
            {joinUrl}
          </p>
          {sortedTeams.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-3 max-w-5xl min-h-0 overflow-hidden">
              {sortedTeams.map((team, i) => (
                <div key={team.id} className="glass-card rounded-2xl px-7 py-4 flex items-center gap-4"
                  style={{ animation: `slide-up-in 0.4s ease-out ${0.4 + i * 0.08}s both` }}>
                  <span
                    className="rounded-full shrink-0 flex items-center justify-center font-black text-amber-950"
                    style={{
                      width: 'clamp(2.25rem, 3vw, 3rem)',
                      height: 'clamp(2.25rem, 3vw, 3rem)',
                      fontSize: 'clamp(1rem, 1.8vw, 1.5rem)',
                      background: 'linear-gradient(145deg, #fcd34d 0%, #f59e0b 60%, #c2650a 100%)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)',
                    }}
                  >
                    {team.name.charAt(0).toUpperCase()}
                  </span>
                  <p className="font-bold" style={{ fontSize: 'clamp(1rem, 2.5vw, 2rem)' }}>{team.name}</p>
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center" style={{ animation: 'slide-up-in 0.5s ease-out 0.45s both' }}>
              <PintHero className="w-14 h-22 mb-4 opacity-80" />
              <p className="text-amber-100/60" style={{ fontSize: 'clamp(1rem, 2.5vw, 1.75rem)' }}>
                Waiting for the first team to grab a table…
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Final Jeopardy answer reveal ─────────────────────────
  if (room.status === 'final_jeopardy' && fjReveal) {
    const { teamName: rName, response, result, wager, newScore } = fjReveal
    return (
      <div className={`min-h-screen text-white flex flex-col items-center justify-center p-12 text-center ${
        result === 'correct' ? 'bg-green-950' : result === 'wrong' ? 'bg-red-950' : 'bg-gray-950'
      }`}>
        <p className="text-gray-500 uppercase tracking-widest mb-4"
          style={{ fontSize: 'clamp(1rem, 2.5vw, 1.75rem)' }}>
          {fjCategoryName}
        </p>
        <p className="font-black text-yellow-400 leading-none mb-6"
          style={{ fontSize: 'clamp(3rem, 10vw, 8rem)' }}>
          {rName}
        </p>
        <div className="bg-gray-900/60 border border-gray-700 rounded-3xl px-12 py-8 max-w-4xl mb-6">
          <p className={`font-bold leading-snug ${response ? 'text-white' : 'text-gray-600 italic'}`}
            style={{ fontSize: 'clamp(1.5rem, 4vw, 3.5rem)' }}>
            {response ?? 'No response'}
          </p>
        </div>
        {result && (
          <div className={`mt-4 ${result === 'correct' ? 'text-green-400' : 'text-red-400'}`}>
            <p className="font-black" style={{ fontSize: 'clamp(2rem, 6vw, 5rem)' }}>
              {result === 'correct' ? `✓ +${wager}` : `✗ −${wager}`}
            </p>
            <p className="font-mono font-bold mt-1" style={{ fontSize: 'clamp(1.25rem, 3vw, 2.5rem)' }}>
              {newScore}
            </p>
          </div>
        )}
        {/* Score strip */}
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900/90 border-t border-gray-800 py-3 px-10 flex justify-center gap-12">
          {sortedTeams.map(team => {
            const delta = scoreDeltas.find(d => d.teamId === team.id)
            return (
              <div key={team.id} className="text-center relative">
                <p className="text-gray-400 leading-tight" style={{ fontSize: 'clamp(0.7rem, 1.5vw, 1.1rem)' }}>
                  {team.name}
                </p>
                <AnimatedScore
                  value={scores.get(team.id) ?? team.score}
                  className={`font-mono font-black tabular-nums ${
                    (scores.get(team.id) ?? 0) < 0 ? 'text-red-400' : 'text-yellow-400'
                  }`}
                  style={{ fontSize: 'clamp(1rem, 2.5vw, 2rem)', display: 'block' }}
                />
                {delta && (
                  <span
                    className={`absolute -top-5 left-1/2 -translate-x-1/2 font-black text-sm tabular-nums pointer-events-none ${delta.delta > 0 ? 'text-green-400' : 'text-red-400'}`}
                    style={{ animation: 'float-up 1.2s ease-out forwards' }}
                  >
                    {delta.delta > 0 ? '+' : ''}{delta.delta}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Final Jeopardy wager / question screens ───────────────
  if (room.status === 'final_jeopardy') {
    const fjTeams = teams.filter(t => t.is_active)

    // Question revealed + timer running
    if (fjQuestion) {
      const dur  = 90
      const rem  = fjTimeRemaining ?? dur
      const pct  = (rem / dur) * 100
      const low  = rem <= 15
      return (
        <div className="h-screen final-bg text-white flex flex-col overflow-hidden">
          {/* Timer bar */}
          <div className="h-3 bg-black/40 w-full shrink-0">
            <div
              className={`h-full transition-all duration-500 ${low ? 'bg-red-500' : 'bg-yellow-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex-1 flex flex-col items-center justify-center px-16 text-center">
            <p className="text-amber-400 uppercase tracking-[0.3em] mb-6"
              style={{ fontSize: 'clamp(1rem, 2.5vw, 1.75rem)' }}>
              Final Tap — {fjCategoryName}
            </p>
            <p className="font-black text-white leading-tight mb-10 max-w-5xl"
              style={{ fontSize: 'clamp(2rem, 5.5vw, 5rem)' }}>
              {fjQuestion.answer}
            </p>
            <p className={`font-mono font-black tabular-nums leading-none ${low ? 'text-red-400' : 'text-gray-400'}`}
              style={{ fontSize: 'clamp(5rem, 15vw, 12rem)', animation: low ? 'timer-pulse 0.8s ease-in-out infinite' : undefined }}>
              {rem}
            </p>
          </div>
          {/* Score strip */}
          <div className="shrink-0 bg-gray-900 border-t border-gray-800 py-3 px-10 flex justify-center gap-12">
            {fjTeams.map(team => (
              <div key={team.id} className="text-center relative">
                <p className="text-gray-400 leading-tight" style={{ fontSize: 'clamp(0.7rem, 1.5vw, 1.1rem)' }}>
                  {team.name}
                </p>
                <AnimatedScore
                  value={scores.get(team.id) ?? team.score}
                  className={`font-mono font-black tabular-nums ${
                    (scores.get(team.id) ?? 0) < 0 ? 'text-red-400' : 'text-yellow-400'
                  }`}
                  style={{ fontSize: 'clamp(1rem, 2.5vw, 2rem)', display: 'block' }}
                />
              </div>
            ))}
          </div>
        </div>
      )
    }

    // Wager collection phase
    return (
      <div className="min-h-screen final-bg text-white flex flex-col items-center justify-center p-12 text-center">
        <p className="text-amber-400 uppercase tracking-[0.4em] mb-4"
          style={{ fontSize: 'clamp(1rem, 2.5vw, 1.75rem)' }}>
          Final Tap
        </p>
        <p className="font-black text-white leading-none mb-12"
          style={{ fontSize: 'clamp(3rem, 12vw, 9rem)' }}>
          {fjCategoryName}
        </p>
        <div className="flex flex-wrap justify-center gap-6">
          {fjTeams.map(team => {
            const wagered = fjWagerStatus.has(team.id)
            return (
              <div key={team.id} className={`rounded-2xl px-8 py-5 flex items-center gap-4 ${
                wagered ? 'bg-green-900/40 border-2 border-green-500/60' : 'bg-gray-900 border border-gray-700'
              }`}>
                <span className={`w-3 h-3 rounded-full shrink-0 ${wagered ? 'bg-green-400' : 'bg-gray-600 animate-pulse'}`} />
                <p className="font-bold" style={{ fontSize: 'clamp(1rem, 2.5vw, 2rem)' }}>{team.name}</p>
                <p className={`text-sm font-semibold ${wagered ? 'text-green-400' : 'text-gray-600'}`}>
                  {wagered ? 'Ready' : 'Wagering…'}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Game over — full-screen winner celebration (yields to the score map
  // while the host has it up)
  if (room.status === 'finished' && !intermissionSnapshots) {
    const finalSorted = [...teams].sort(
      (a, b) => (scores.get(b.id) ?? b.score) - (scores.get(a.id) ?? a.score)
    )
    const winner = finalSorted[0]
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8 text-center">
        <Confetti
          active={confettiActive}
          onDone={() => {
            setConfettiActive(false)
            // A few more bursts so the room gets a proper send-off
            if (++confettiBurstsRef.current < 4) {
              setTimeout(() => setConfettiActive(true), 900)
            }
          }}
        />
        <p className="text-gray-500 uppercase tracking-widest mb-4" style={{ fontSize: 'clamp(1.25rem, 3vw, 2.5rem)', animation: 'slide-up-in 0.5s ease-out both' }}>
          🏆 Winner 🏆
        </p>
        <p className="font-black text-yellow-400 leading-none mb-2"
          style={{ fontSize: 'clamp(3.5rem, 14vw, 10rem)', animation: 'pop-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both' }}>
          {winner?.name ?? '—'}
        </p>
        <AnimatedScore
          value={scores.get(winner?.id ?? '') ?? winner?.score ?? 0}
          className="font-mono font-black text-yellow-300 mb-12 block"
          style={{ fontSize: 'clamp(2rem, 6vw, 5rem)' }}
        />
        <p className="text-yellow-300 mb-12" style={{ fontSize: 'clamp(1rem, 2vw, 1.75rem)', marginTop: '-3rem' }}>pts</p>
        <div className="space-y-3 w-full max-w-2xl">
          {finalSorted.map((team, i) => (
            <div key={team.id} className={`flex items-center gap-4 rounded-2xl px-8 py-5 ${
              i === 0 ? 'bg-yellow-400/10 border-2 border-yellow-400/60' : 'bg-gray-900 border border-gray-800'
            }`}
              style={{ animation: `slide-up-in 0.5s ease-out ${0.6 + i * 0.15}s both` }}>
              <span className="w-12 shrink-0 text-right"
                style={{ fontSize: 'clamp(1.25rem, 3vw, 2rem)' }}>
                {i < 3 ? ['🥇', '🥈', '🥉'][i] : <span className="text-gray-600 font-mono">{i + 1}</span>}
              </span>
              <span className="font-bold flex-1 text-left" style={{ fontSize: 'clamp(1.25rem, 3vw, 2rem)' }}>
                {team.name}
              </span>
              <AnimatedScore
                value={scores.get(team.id) ?? team.score}
                className={`font-mono font-black tabular-nums ${
                  (scores.get(team.id) ?? team.score) < 0 ? 'text-red-400' : 'text-yellow-400'
                }`}
                style={{ fontSize: 'clamp(1.25rem, 3vw, 2rem)' }}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Category preview (player selected, waiting for host to open buzzer)
  if (previewInfo && !activeQuestion) {
    return (
      <div className="h-screen wood-bg text-white flex flex-col items-center justify-center text-center p-8">
        <p className="text-amber-300 uppercase tracking-[0.3em] mb-8"
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
        <p className="text-amber-200/60 uppercase tracking-widest animate-pulse"
          style={{ fontSize: 'clamp(1rem, 2.5vw, 1.75rem)' }}>
          Listening…
        </p>
      </div>
    )
  }

  // Double tap splash
  if (doubleTapSplash) {
    return (
      <div className="h-screen bg-amber-950 text-white flex flex-col items-center justify-center text-center">
        <div style={{ animation: 'double-tap-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
          <p style={{ fontSize: 'clamp(6rem, 18vw, 14rem)' }}>🍺</p>
          <p className="font-black text-amber-400 leading-none" style={{ fontSize: 'clamp(4rem, 12vw, 10rem)' }}>
            DOUBLE TAP!
          </p>
          <p className="text-amber-200 font-bold mt-4" style={{ fontSize: 'clamp(1.5rem, 4vw, 3rem)' }}>
            A player is wagering…
          </p>
        </div>
      </div>
    )
  }

  // Round intermission / end-of-game score map
  if (intermissionSnapshots) {
    const teamIds  = sortedTeams.map(t => t.id)
    const teamNameMap = new Map(teams.map(t => [t.id, t.name]))
    const mapPhase: 'r1' | 'r2' | 'final' =
      room.status === 'finished' ? 'final' : room.status === 'round_2' ? 'r2' : 'r1'
    return (
      <div className="h-screen bar-bg text-white flex flex-col p-8 gap-6">
        <div className="text-center shrink-0">
          <p className="text-gray-500 uppercase tracking-[0.4em] mb-2"
            style={{ fontSize: 'clamp(1rem, 2vw, 1.5rem)', animation: 'slide-up-in 0.4s ease-out both' }}>
            {mapPhase === 'final' ? 'The whole game, every swing'
              : mapPhase === 'r2' ? 'Round 2 in the books'
              : 'Round 1 in the books'}
          </p>
          <p className="font-black text-yellow-400"
            style={{ fontSize: 'clamp(3rem, 8vw, 6rem)', animation: 'pop-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both' }}>
            {mapPhase === 'final' ? '🍻 The Final Pour' : mapPhase === 'r2' ? '🍻 Last Call' : '🍻 Halftime'}
          </p>
          <p className="text-gray-400 font-semibold"
            style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.4rem)', animation: 'slide-up-in 0.4s ease-out 0.4s both' }}>
            {mapPhase === 'final' ? 'Cheers to every team 🍻'
              : mapPhase === 'r2' ? 'Final Tap up next — one wager decides it all'
              : 'Round 2 up next — bigger points on the board'}
          </p>
        </div>
        <div className="flex-1 min-h-0">
          <ScoreHistoryChart
            snapshots={intermissionSnapshots}
            teamNames={teamNameMap}
            teamIds={teamIds}
          />
        </div>
        <div className="shrink-0 flex justify-center gap-8 flex-wrap">
          {sortedTeams.map((team, i) => (
            <div key={team.id} className="text-center"
              style={{ animation: `slide-up-in 0.4s ease-out ${0.5 + i * 0.1}s both` }}>
              <p className="text-gray-400 flex items-center justify-center gap-2" style={{ fontSize: 'clamp(0.8rem, 1.5vw, 1.25rem)' }}>
                <span className="inline-block rounded-full shrink-0"
                  style={{ width: '0.7em', height: '0.7em', background: getTeamColor(team.id, sortedTeams.map(t => t.id)) }} />
                {i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`} {team.name}
              </p>
              <AnimatedScore
                value={scores.get(team.id) ?? team.score}
                className={`font-mono font-black tabular-nums block ${
                  (scores.get(team.id) ?? 0) < 0 ? 'text-red-400' : 'text-yellow-400'
                }`}
                style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)' }}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Round transition splash
  if (roundSplash) {
    return (
      <div className="h-screen bg-gray-950 text-white flex items-center justify-center">
        <p
          className="font-black text-yellow-400 text-center"
          style={{ fontSize: 'clamp(5rem, 18vw, 14rem)', animation: 'round-splash-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
        >
          {roundSplash}
        </p>
      </div>
    )
  }

  // Category grid (no active question)
  if (!activeQuestion && categories.length > 0) {
    const roundLabel = room.status === 'round_2' ? 'Round 2' : 'Round 1'
    return (
      <div className="h-screen bar-bg text-white flex flex-col overflow-hidden p-3 gap-2">
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
            {sortedTeams.map(team => {
              const delta = scoreDeltas.find(d => d.teamId === team.id)
              return (
                <div key={team.id} className="text-center relative">
                  <p className="text-gray-400 leading-tight" style={{ fontSize: 'clamp(0.7rem, 1.5vw, 1rem)' }}>
                    {team.name}
                  </p>
                  <AnimatedScore
                    value={scores.get(team.id) ?? team.score}
                    className={`font-mono font-black tabular-nums ${
                      (scores.get(team.id) ?? 0) < 0 ? 'text-red-400' : 'text-yellow-300'
                    }`}
                    style={{ fontSize: 'clamp(1rem, 2.5vw, 1.75rem)', display: 'block' }}
                  />
                  {delta && (
                    <span
                      className={`absolute -top-6 left-1/2 -translate-x-1/2 font-black text-sm tabular-nums pointer-events-none ${delta.delta > 0 ? 'text-green-400' : 'text-red-400'}`}
                      style={{ animation: 'float-up 1.2s ease-out forwards' }}
                    >
                      {delta.delta > 0 ? '+' : ''}{delta.delta}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Category headers */}
        <div className="grid gap-2 shrink-0"
          style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}>
          {categories.map(cat => (
            <TapHeader key={cat.id} categoryName={cat.name} />
          ))}
        </div>

        {/* Glass shelves. The glasses keep their real proportions (fit), which on a
            16:9 screen leaves air between columns — so the air becomes the bar:
            bright epoxy-sealed wood planks run the full width under each row and
            every glass sits on one. min-h-0 + minmax(0,1fr) rows keep it all
            inside the viewport (bare 1fr can't shrink below the SVG's intrinsic
            aspect-ratio height). */}
        <div className="flex-1 min-h-0 relative">
          {pointValues.map((pv, k) => {
            const n = pointValues.length
            const G = 8 // row gap in px (gap-2) — planks land in the gaps
            return (
              <div key={pv} aria-hidden className="absolute left-0 right-0 rounded-[3px]"
                style={{
                  top: `calc((100% - ${(n - 1) * G}px) * ${(k + 1) / n} + ${k * G}px - 3px)`,
                  height: 15,
                  background: [
                    'linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0.05) 45%, rgba(255,255,255,0) 60%)',
                    'repeating-linear-gradient(90deg, rgba(122,63,12,0.14) 0 3px, transparent 3px 11px, rgba(122,63,12,0.09) 11px 17px, transparent 17px 31px)',
                    'linear-gradient(180deg, #e8ba79 0%, #cd9550 55%, #9c6c30 100%)',
                  ].join(', '),
                  boxShadow: '0 5px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.65), inset 0 -2px 3px rgba(0,0,0,0.3)',
                }}
              />
            )
          })}
          <div className="h-full grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${pointValues.length}, minmax(0, 1fr))`,
            }}
          >
            {pointValues.map(pv =>
              categories.map(cat => {
                const q        = cat.questions.find(q => q.point_value === pv)
                if (!q) return <div key={`${cat.id}-${pv}`} />
                const answered = q.is_answered
                return (
                  <BeerGlass key={`${cat.id}-${pv}`} pointValue={pv} state={answered ? 'empty' : 'full'} disabled fit />
                )
              })
            )}
          </div>
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
                style={{ fontSize: 'clamp(4rem, 12vw, 9rem)', animation: timerLow ? 'timer-pulse 0.8s ease-in-out infinite' : undefined }}>
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
          {sortedTeams.map(team => {
            const delta = scoreDeltas.find(d => d.teamId === team.id)
            return (
              <div key={team.id} className="text-center relative">
                <p className="text-gray-400 leading-tight" style={{ fontSize: 'clamp(0.7rem, 1.5vw, 1.1rem)' }}>
                  {team.name}
                </p>
                <AnimatedScore
                  value={scores.get(team.id) ?? team.score}
                  className={`font-mono font-black tabular-nums ${
                    (scores.get(team.id) ?? 0) < 0 ? 'text-red-400' : 'text-yellow-400'
                  }`}
                  style={{ fontSize: 'clamp(1rem, 2.5vw, 2rem)', display: 'block' }}
                />
                {delta && (
                  <span
                    className={`absolute -top-5 left-1/2 -translate-x-1/2 font-black text-sm tabular-nums pointer-events-none ${delta.delta > 0 ? 'text-green-400' : 'text-red-400'}`}
                    style={{ animation: 'float-up 1.2s ease-out forwards' }}
                  >
                    {delta.delta > 0 ? '+' : ''}{delta.delta}
                  </span>
                )}
              </div>
            )
          })}
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
