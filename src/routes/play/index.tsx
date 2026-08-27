import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ablyClient, serverNow, getClockOffsetMs } from '../../lib/ably'
import {
  clearPlayerSession,
  getSessionId,
  getTeamId,
  setTeamId,
} from '../../lib/session'
import type { Buzz, Player, QuestionPublic, Room, ScoreSnapshot, Team } from '../../lib/types'
import AnimatedScore from '../../components/AnimatedScore'
import Confetti from '../../components/Confetti'
import ScoreOverlay from '../../components/ScoreOverlay'
import ScoreHistoryChart, { getTeamColor } from '../../components/ScoreHistoryChart'
import { TipJar, VenueFooter } from '../../components/TipJar'
import FeedbackForm from '../../components/FeedbackForm'
import { BeerGlass, TapHeader, tapHeaderRevealFor } from '../../components/TapCategoryColumn'
import { compareCategoryOrder } from '../../lib/categoryOrder'
import { useVisualViewportHeight } from '../../lib/useVisualViewportHeight'
import { Bubbles, PintHero, CheersPints, SoloPint } from '../../components/Barware'
import { QUIPS } from '../../lib/quips'
import { findCurrentActiveRoom, getLocalDayStartIso } from '../../lib/roomDiscovery'
import {
  playBuzz,
  playCorrect,
  playWrong,
  playDoubleTap,
} from '../../lib/sounds'

type Phase = 'checking' | 'no_lobby' | 'choose_mode' | 'solo_name' | 'join_lobby' | 'select_team' | 'lobby' | 'game'

// Every phase before the game itself. Listed once so that adding a join screen
// cannot silently skip the finished-room bounce or the host's lobby_closed kick —
// both used to inline this array, and both would have stranded players on the
// Team-or-Solo screens.
const PRE_GAME_PHASES: Phase[] = ['choose_mode', 'solo_name', 'join_lobby', 'select_team', 'lobby']

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
  answer?: string
}

// How long the DB-driven reveal path waits for the Ably broadcast to claim a reveal
// before falling back to its own fetch. Covers missed broadcasts and page refreshes,
// while giving the (near-instant) broadcast time to win on a normal live activation.
const REVEAL_FALLBACK_GRACE_MS = 500

// "1st" / "2nd" / "3rd" / "11th" — handles the 11-13 special cases correctly
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
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
      className="text-amber-100/40 text-xs mt-6 max-w-xs text-center px-4 leading-relaxed"
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
  const [selectionClaiming, setSelectionClaiming] = useState(false)
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null)

  // Game state
  const [activeQuestion, setActiveQuestion]   = useState<QuestionPublic | null>(null)
  const [hasBuzzed, setHasBuzzed]             = useState(false)
  const [buzzWasMine, setBuzzWasMine]         = useState(false)
  const [myBuzzId, setMyBuzzId]               = useState<string | null>(null)
  const [buzzing, setBuzzing]                 = useState(false)
  const [timerPayload, setTimerPayload]         = useState<TimerPayload | null>(null)
  const [buzzWindowTs, setBuzzWindowTs]         = useState<number | null>(null)
  const [buzzWindowRemaining, setBuzzWindowRemaining] = useState<number | null>(null)
  const [timeRemaining, setTimeRemaining]       = useState<number | null>(null)
  const [responseText, setResponseText]       = useState('')
  const [responseSubmitted, setResponseSubmitted] = useState(false)
  const [buzzPosition, setBuzzPosition]       = useState<number | null>(null)
  const [buzzResult, setBuzzResult]           = useState<'correct' | 'wrong' | null>(null)
  // Anti-spam: taps landing on the pre-buzzer (preview) screen. 3+ before the buzzer
  // actually appears locks this device out of buzzing for the current question.
  const [soloName, setSoloName]               = useState('')
  const [preBuzzTaps, setPreBuzzTaps]         = useState(0)
  // Timestamps of recent preview taps. The lockout triggers on a BURST, not on a
  // running total: the overlay covers the whole screen, so three incidental
  // touches spread across a long preview (regripping, handing the phone over, a
  // tremor) are not spam and must not cost someone the question.
  const preBuzzTapTimesRef                   = useRef<number[]>([])
  const [buzzLockedOut, setBuzzLockedOut]     = useState(false)
  // Buzz insert failed (flaky wifi) — surface it loudly so the player retries
  // instead of silently believing they're in the queue.
  const [buzzFailed, setBuzzFailed]           = useState(false)
  // Brief full-screen splash on the phone when Round 2 opens
  const [playerRoundSplash, setPlayerRoundSplash] = useState(false)
  const [myScore, setMyScore]                 = useState(0)
  const [allTeamScores, setAllTeamScores]     = useState<Array<{ id: string; name: string; score: number }>>([])
  const [currentTurnTeamId, setCurrentTurnTeamId] = useState<string | null>(null)
  const [boardCategories, setBoardCategories] = useState<BoardCategory[]>([])
  // Round-start category reveal (host-driven): ids revealed so far, in reveal
  // order; null = inactive → whole board shown. Self-heals: cleared by the done
  // broadcast, any round change, AND any question preview/activation — so a
  // phone that missed `done` can never stay gated once play actually starts.
  const [catRevealIds, setCatRevealIds] = useState<string[] | null>(null)

  // Answer screens size to this so the phone keyboard can't bury the submit button
  const viewportHeight = useVisualViewportHeight()
  const [teamNames, setTeamNames]             = useState<Map<string, string>>(new Map())
  const [previewInfo, setPreviewInfo]         = useState<PreviewInfo | null>(null)
  const [doubleTapTeamId, setDoubleTapTeamId] = useState<string | null>(null)
  const [dtRevealForObserver, setDtRevealForObserver] = useState(false)
  const [dtTeammateWaiting, setDtTeammateWaiting] = useState(false)

  // UI state
  const [showScoreOverlay, setShowScoreOverlay] = useState(false)
  const [scoreChipPulse, setScoreChipPulse]     = useState(false)
  const [showConfetti, setShowConfetti]           = useState(false)
  const [ripples, setRipples]                     = useState<Array<{ id: number; x: number; y: number }>>([])

  // Double Tap state
  const [doubleTapStep, setDoubleTapStep]       = useState<'reveal' | 'wager' | null>(null)
  const [doubleTapPendingQ, setDoubleTapPendingQ] = useState<{
    questionId: string; rect: DOMRect | null
  } | null>(null)
  const [doubleTapWagerInput, setDoubleTapWagerInput] = useState('')

  // Final Jeopardy state
  type FjSubPhase = 'incoming' | 'wager' | 'wager_locked' | 'question' | 'reviewing' | 'done' | null
  const [fjSubPhase, setFjSubPhase]           = useState<FjSubPhase>(null)
  const [fjCategoryName, setFjCategoryName]   = useState('')
  const [fjWagerInput, setFjWagerInput]       = useState('')
  const [fjWagerId, setFjWagerId]             = useState<string | null>(null)
  const [fjLockedWagerAmount, setFjLockedWagerAmount] = useState<number | null>(null)
  const [fjQuestion, setFjQuestion]           = useState<QuestionPublic | null>(null)
  const [fjResponse, setFjResponse]           = useState('')
  const [fjResponseSubmitted, setFjResponseSubmitted] = useState(false)
  const [fjResponseSubmitting, setFjResponseSubmitting] = useState(false)
  const [fjResponseError, setFjResponseError] = useState('')
  const [fjResponseDeadline, setFjResponseDeadline] = useState<number | null>(null)
  const [fjTimeRemaining, setFjTimeRemaining] = useState<number | null>(null)
  const [fjFinalScores, setFjFinalScores]     = useState<Array<{ id: string; name: string; score: number }>>([])

  // Round intermission (score history graph)
  const [intermissionSnapshots, setIntermissionSnapshots] = useState<ScoreSnapshot[] | null>(null)
  // Chart highlight — driven from both the chart lines AND the standings list below it.
  // undefined = untouched (defaults to my team), null = explicitly deselected.
  const [intermissionSelectedId, setIntermissionSelectedId] = useState<string | null | undefined>(undefined)

  const fjResponseRef = useRef('')
  const fjWagerIdRef  = useRef<string | null>(null)
  const fjResponseSubmitInFlightRef = useRef(false)
  const fjAutoSubmitStartedRef = useRef(false)
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
  const timerBuzzIdRef         = useRef<string | null>(null) // buzz_id from timerPayload for teammate matching
  const revealClaimRef         = useRef<string | null>(null) // question id whose reveal is owned by the Ably broadcast path
  const revealTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null) // pending scheduled reveal
  const selectionClaimingRef   = useRef(false)
  const selectionNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Beta-test timing tool (host-toggled, see docs): remembers the last-seen debugTiming
  // flag so even a device that fell to the FALLBACK-DB path (missed the broadcast
  // entirely) still knows to self-report via buzz_debug_report.
  const debugTimingRef         = useRef(false)

  useEffect(() => { responseSubmittedRef.current = responseSubmitted }, [responseSubmitted])
  useEffect(() => { responseTextRef.current = responseText }, [responseText])
  useEffect(() => { myBuzzIdRef.current = myBuzzId }, [myBuzzId])
  useEffect(() => { timerBuzzIdRef.current = timerPayload?.buzz_id ?? null }, [timerPayload])
  useEffect(() => { myTeamRef.current = myTeam }, [myTeam])
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { currentTurnTeamIdRef.current = currentTurnTeamId }, [currentTurnTeamId])
  useEffect(() => { phaseRef.current = phase }, [phase])

  const submitFinalResponse = useCallback(async (response: string) => {
    const team = myTeamRef.current
    const currentRoom = roomRef.current
    if (!team || !currentRoom || fjResponseSubmitInFlightRef.current) return false

    fjResponseSubmitInFlightRef.current = true
    setFjResponseSubmitting(true)
    setFjResponseError('')

    try {
      const { data, error } = await supabase.rpc('submit_final_response', {
        p_room_id: currentRoom.id,
        p_team_id: team.id,
        p_session_id: getSessionId(),
        p_response: response.trim(),
      })

      if (error) {
        const timedOut = error.message.includes('window has closed')
          || error.message.includes('window is not open')
        setFjResponseError(timedOut
          ? 'Time expired before your response reached the server.'
          : "Couldn't lock your response. Check your connection and try again.")
        if (timedOut) setFjTimeRemaining(0)
        return false
      }

      const saved = data?.[0]
      if (!saved) {
        setFjResponseError("Couldn't confirm your response. Please try again.")
        return false
      }

      setFjWagerId(saved.wager_id)
      setFjResponse(saved.saved_response ?? '')
      setFjResponseSubmitted(true)
      return true
    } finally {
      fjResponseSubmitInFlightRef.current = false
      setFjResponseSubmitting(false)
    }
  }, [])

  useEffect(() => () => {
    if (selectionNoticeTimerRef.current) clearTimeout(selectionNoticeTimerRef.current)
  }, [])

  // Whether this phone won the team's current buzz claim is per-question state.
  useEffect(() => { setBuzzWasMine(false) }, [activeQuestion?.id])

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
    // Named columns (never `*`) so category descriptions stay off player phones.
    // `position` may not exist yet — naming a missing column errors the whole
    // query, so fall back to the legacy list and let the sort go alphabetical.
    let cats: Array<{ id: string; name: string; position?: number | null }> | null = (await supabase
      .from('categories').select('id, name, position').eq('room_id', roomId).eq('round', round)).data
    if (!cats) {
      cats = (await supabase
        .from('categories').select('id, name').eq('room_id', roomId).eq('round', round)).data
    }
    if (!cats?.length) { setBoardCategories([]); return }
    cats = [...cats].sort(compareCategoryOrder)
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
      try {
        const activeRoom = await findCurrentActiveRoom()
        if (!activeRoom) { setPhase('no_lobby'); return }
        setRoom(activeRoom)
        setPhase('choose_mode')
      } catch {
        setPhase('no_lobby')
      }
    }

    // Resume must distinguish "the server says you are not on this team" from "the
    // query did not come back". Both used to look identical (data === null), and
    // both cleared the saved team — so one flaky request on a mid-game refresh
    // ejected a live player AND destroyed the seat, making further refreshes
    // useless. Only a clean answer from the server is allowed to clear anything.
    async function resume(teamId: string, attempt = 0): Promise<void> {
      const [teamRes, playerRes] = await Promise.all([
        supabase.from('teams').select().eq('id', teamId).maybeSingle(),
        supabase.from('players')
          .select('id')
          .eq('team_id', teamId)
          .eq('session_id', getSessionId())
          .maybeSingle(),
      ])

      if (teamRes.error || playerRes.error) return retryResume(teamId, attempt)

      const teamData = teamRes.data
      const playerMembership = playerRes.data
      // Clean answer, genuinely not a member (team deleted, or removed by the host).
      if (!teamData || !playerMembership) { clearPlayerSession(); return autoResolve() }

      const roomRes = await supabase
        .from('rooms')
        .select()
        .eq('id', teamData.room_id)
        .neq('status', 'finished')
        .gte('created_at', getLocalDayStartIso())
        .maybeSingle()

      if (roomRes.error) return retryResume(teamId, attempt)
      const roomData = roomRes.data
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

    // Keep retrying rather than ejecting. The saved team is left untouched, so even
    // if the player closes the tab mid-outage they can still resume later.
    async function retryResume(teamId: string, attempt: number): Promise<void> {
      if (attempt >= 6) return          // stay on the loading screen; a refresh retries
      const backoff = Math.min(4000, 400 * 2 ** attempt)
      await new Promise(r => setTimeout(r, backoff))
      return resume(teamId, attempt + 1)
    }

    if (savedTeamId) void resume(savedTeamId)
    else void autoResolve()
  }, [fetchTeammates, refreshAllScores])

  // Poll for an active room while in 'no_lobby' phase (every 3 seconds)
  useEffect(() => {
    if (phase !== 'no_lobby') return
    const id = setInterval(async () => {
      try {
        const activeRoom = await findCurrentActiveRoom()
        if (!activeRoom) return
        setRoom(activeRoom)
        setPhase('choose_mode')
      } catch { /* keep polling through transient connection errors */ }
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

  // Ably reconnect → re-read scores from the database.
  // During gameplay myScore/allTeamScores are fed ONLY by the 'score_update'
  // broadcast (the teams postgres_changes subscription is gated to the
  // select_team phase), so a drop across a judgment leaves this phone showing a
  // stale score until some later phase change happens to refresh it.
  useEffect(() => {
    const roomId = room?.id
    if (!roomId) return
    let dropped = false
    const onDown = () => { dropped = true }
    const onUp = async () => {
      // 'connected' also fires on the first ever connect, which needs no resync.
      if (!dropped) return
      dropped = false
      const { data } = await supabase.from('teams').select('id, name, score').eq('room_id', roomId)
      if (!data) return
      setAllTeamScores(data)
      const mine = data.find(t => t.id === myTeamRef.current?.id)
      if (mine) setMyScore(mine.score)
    }
    ablyClient.connection.on('disconnected', onDown)
    ablyClient.connection.on('suspended', onDown)
    ablyClient.connection.on('connected', onUp)
    return () => {
      ablyClient.connection.off('disconnected', onDown)
      ablyClient.connection.off('suspended', onDown)
      ablyClient.connection.off('connected', onUp)
    }
  }, [room?.id])

  // Hydrate currentTurnTeamId from room.current_turn_team_id (polling fallback for turn persistence)
  useEffect(() => {
    if (phase === 'game' && room?.current_turn_team_id !== undefined) {
      setCurrentTurnTeamId(room.current_turn_team_id ?? null)
    }
  }, [room?.current_turn_team_id, phase])

  // Refresh survival for the score-map intermission (broadcast-only state): restore
  // the chart from sessionStorage as long as the room hasn't moved on to the next
  // phase; discard the saved copy the moment it has.
  useEffect(() => {
    if (phase !== 'game' || !room?.id || intermissionSnapshots) return
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
  }, [phase, room?.id, room?.status, intermissionSnapshots])

  // Database fallback for an accepted pick whose broadcast was missed or for a
  // device that reconnected during the preview.
  useEffect(() => {
    const questionId = room?.pending_question_id
    if (phase !== 'game' || !questionId || room.current_question_id || activeQuestion || previewInfo) return
    const category = boardCategories.find(c => c.questions.some(q => q.id === questionId))
    const question = category?.questions.find(q => q.id === questionId)
    if (!category || !question) return

    if (question.is_double_tap) {
      const selectingTeamId = room.pending_selection_team_id ?? null
      setDoubleTapTeamId(selectingTeamId)
      if (room.pending_selection_wager !== null && room.pending_selection_wager !== undefined) {
        setDtRevealForObserver(false)
        setDtTeammateWaiting(false)
        setPreviewInfo({
          questionId,
          categoryName: category.name,
          pointValue: question.point_value,
          startTs: room.pending_selection_claimed_at
            ? new Date(room.pending_selection_claimed_at).getTime()
            : Date.now(),
          doubleTapWager: room.pending_selection_wager,
          answer: question.answer,
        })
        return
      }
      // No pending session = host-assigned DT: every phone on the chosen team gets
      // the wager screen (first submit wins), not just a single initiating device.
      const hostAssignedToMyTeam = !room.pending_selection_session_id && selectingTeamId != null && selectingTeamId === myTeam?.id
      if (room.pending_selection_session_id === getSessionId() || hostAssignedToMyTeam) {
        setDoubleTapPendingQ({ questionId, rect: null })
        setDoubleTapStep(prev => prev ?? 'wager')
      } else if (selectingTeamId === myTeam?.id) {
        setDtTeammateWaiting(true)
      } else {
        setDtRevealForObserver(true)
      }
      return
    }

    setPreviewInfo({
      questionId,
      categoryName: category.name,
      pointValue: question.point_value,
      startTs: room.pending_selection_claimed_at
        ? new Date(room.pending_selection_claimed_at).getTime()
        : Date.now(),
      answer: question.answer,
    })
  }, [
    phase,
    room?.pending_question_id,
    room?.pending_selection_team_id,
    room?.pending_selection_session_id,
    room?.pending_selection_claimed_at,
    room?.pending_selection_wager,
    room?.current_question_id,
    activeQuestion,
    previewInfo,
    boardCategories,
    myTeam?.id,
  ])

  // A persisted finished room is the fallback when the game_over broadcast is missed.
  // Pre-game visitors leave the old room; active players recover the final scoreboard.
  useEffect(() => {
    if (room?.status !== 'finished') return
    if (PRE_GAME_PHASES.includes(phase)) {
      clearPlayerSession()
      setRoom(null); setMyTeam(null); setTeams([])
      setPhase('no_lobby')
      return
    }

    if (phase !== 'game') return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('teams')
        .select('id, name, score')
        .eq('room_id', room.id)
      if (cancelled || !data) return
      setFjFinalScores(data)
      const mine = data.find(t => t.id === myTeamRef.current?.id)
      if (mine) setMyScore(mine.score)
      setFjSubPhase('done')
    })()
    return () => { cancelled = true }
  }, [room?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Kick via broadcast: host sends lobby_closed on the room channel
  useEffect(() => {
    if (!room?.id || !PRE_GAME_PHASES.includes(phase)) return
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
      const qId = room.current_question_id
      // The Ably `question_activated` handler owns the reveal for live activations
      // (it schedules the buzzer for a shared instant). This DB path is only a fallback
      // for refreshes and missed broadcasts, so it stands down if Ably has claimed qId.
      if (revealClaimRef.current === qId) return

      let cancelled = false
      async function loadQuestion() {
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
        if (cancelled || revealClaimRef.current === qId) return
        if (debugTimingRef.current) {
          broadcastRef.current?.publish('buzz_debug_report', {
            team: myTeamRef.current?.name ?? '?',
            device: ablyClient.auth.clientId?.slice(0, 6) ?? '?',
            clkOffset: Math.round(getClockOffsetMs()),
            recvDelay: null, // broadcast was missed entirely — no receive event to measure
            revealT: serverNow(),
            path: 'FALLBACK-DB',
          })
        }
        setActiveQuestion(question ?? null)
        if (existingBuzz) {
          setHasBuzzed(true)
          setMyBuzzId(existingBuzz.id)
          // Restore the exact server-owned deadline. This preserves Double Tap's
          // 40-second window and never grants fresh time after a reconnect.
          const team = myTeamRef.current
          const duration = question?.is_double_tap ? 40 : 15
          const deadline = new Date(existingBuzz.response_deadline_at).getTime()
          if (team && existingBuzz.status === 'pending') {
            setTimerPayload({
              start_timestamp: deadline - duration * 1000,
              duration_seconds: duration,
              team_id: team.id,
              buzz_id: existingBuzz.id,
              team_name: team.name,
            })
          }
          if (existingBuzz.response) setResponseText(existingBuzz.response)
          if (existingBuzz.response_submitted_at || existingBuzz.status !== 'pending') {
            setResponseSubmitted(true)
          }
        }
      }
      // Give the broadcast a moment to win the race before falling back to a DB fetch.
      const graceTimer = setTimeout(() => {
        if (revealClaimRef.current === qId) return
        loadQuestion()
      }, REVEAL_FALLBACK_GRACE_MS)
      return () => { cancelled = true; clearTimeout(graceTimer) }
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
      const p = data as PreviewInfo & { selectorTeamId?: string; doubleTapPending?: boolean; hostAssigned?: boolean }
      // A question in play means the category intros are over — self-heal any
      // phone that missed the reveal's `done` broadcast (backgrounded, rejoined)
      setCatRevealIds(null)

      // First DT broadcast (tile tap, before wager) — observers show the reveal animation
      if (p.doubleTapPending && p.selectorTeamId) {
        setDoubleTapTeamId(p.selectorTeamId)
        const mine = p.selectorTeamId === myTeamRef.current?.id
        // Preserve isInitiator flag if this device already set it (clicker's own echo).
        // A host-assigned DT has no clicking device — every phone on the team is an
        // initiator, so the wager screen opens on all of them (first submit wins).
        const existingDt = (() => { try { return JSON.parse(sessionStorage.getItem('dtWager') ?? 'null') } catch { return null } })()
        sessionStorage.setItem('dtWager', JSON.stringify({
          selectorTeamId: p.selectorTeamId,
          questionId: p.questionId,
          isInitiator: existingDt?.isInitiator === true || (p.hostAssigned === true && mine),
          roomId: roomRef.current?.id,
        }))
        if (!mine) {
          setDtRevealForObserver(true)
        } else if (p.hostAssigned) {
          setDoubleTapPendingQ({ questionId: p.questionId, rect: null })
          setDoubleTapWagerInput('')
          setDoubleTapStep('reveal')
          playDoubleTap()
          navigator.vibrate?.(200)
          setTimeout(() => setDoubleTapStep('wager'), 2000)
        } else {
          setDtTeammateWaiting(true)
        }
        return // don't show previewInfo yet — wait for the real preview after wager
      }

      // Real preview (post-wager or normal question) — fresh question, so reset the
      // anti-spam tap counter and any lockout carried over from a prior question.
      sessionStorage.removeItem('dtWager')
      setPreBuzzTaps(0)
      setBuzzLockedOut(false)
      setPreviewInfo(p)
      // A wager is locked (by a teammate or a host override) — close any wager
      // screen still open on this device.
      setDoubleTapStep(null)
      setDoubleTapPendingQ(null)
      if (p.doubleTapWager !== undefined && p.selectorTeamId) {
        setDoubleTapTeamId(p.selectorTeamId)
        setDtRevealForObserver(false) // transition to preview overlay
        setDtTeammateWaiting(false)
      }
    })
    ch.subscribe('question_activated', ({ data }) => {
      const { question_id, question, double_tap_team_id, buzz_opened_at, debugTiming } = data as {
        question_id: string; question?: QuestionPublic; double_tap_team_id?: string; buzz_opened_at?: number; debugTiming?: boolean
      }
      setCatRevealIds(null) // intros are over once a question is live
      // Remember whether this question is being timing-tracked, so even the
      // FALLBACK-DB path below (which never sees this payload) knows to self-report.
      debugTimingRef.current = !!debugTiming

      // Defensive: without the inline payload we can't reveal from the broadcast, so
      // don't claim it — just advance current_question_id and let the DB fallback fetch.
      if (!question) {
        setPreviewInfo(null)
        setDoubleTapTeamId(double_tap_team_id ?? null)
        setBuzzWindowTs(buzz_opened_at ?? null)
        if (buzz_opened_at) {
          sessionStorage.setItem('buzzWindow', JSON.stringify({ questionId: question_id, ts: buzz_opened_at }))
        }
        setRoom(prev => prev ? {
          ...prev,
          current_question_id: question_id,
          buzz_opened_at: buzz_opened_at ? new Date(buzz_opened_at).toISOString() : null,
          pending_question_id: null,
          pending_selection_team_id: null,
          pending_selection_session_id: null,
          pending_selection_claimed_at: null,
          pending_selection_wager: null,
        } : prev)
        return
      }

      // Delay measured against the shared server clock, so a skewed OS clock no longer
      // shifts this device's reveal earlier/later than everyone else's. Also fed into
      // the buzz_debug_report below (beta-test timing tool).
      const recvDelay = buzz_opened_at ? buzz_opened_at - serverNow() : null

      // Claim this reveal immediately so the DB fallback path stands down, even though
      // the visible flip is deferred to buzz_opened_at below.
      revealClaimRef.current = question_id
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current)

      // The actual flip to the buzz screen. For regular questions this is scheduled for
      // buzz_opened_at (a shared future instant) so every device reveals simultaneously,
      // bounded by clock accuracy rather than per-device network latency. DT has no buzz
      // window (buzz_opened_at is null) so it reveals immediately.
      const reveal = () => {
        setPreviewInfo(null)
        setDoubleTapTeamId(double_tap_team_id ?? null)
        setBuzzWindowTs(buzz_opened_at ?? null)
        // New question — clear per-question state (buzzLockedOut is intentionally kept:
        // it was set during the preview and must carry into the buzz phase).
        setTimerPayload(null)
        setBuzzResult(null)
        setBuzzFailed(false)
        setHasBuzzed(false)
        setMyBuzzId(null)
        setBuzzPosition(null)
        setResponseText('')
        setResponseSubmitted(false)
        // Persist so the buzz-window countdown survives a page refresh
        if (buzz_opened_at) {
          sessionStorage.setItem('buzzWindow', JSON.stringify({ questionId: question_id, ts: buzz_opened_at }))
        }
        setRoom(prev => prev ? {
          ...prev,
          current_question_id: question_id,
          buzz_opened_at: buzz_opened_at ? new Date(buzz_opened_at).toISOString() : null,
          pending_question_id: null,
          pending_selection_team_id: null,
          pending_selection_session_id: null,
          pending_selection_claimed_at: null,
          pending_selection_wager: null,
        } : prev)
        // Reveal straight from the broadcast payload — no DB fetch in the critical path.
        if (question) setActiveQuestion(question)
        if (debugTimingRef.current) {
          broadcastRef.current?.publish('buzz_debug_report', {
            team: myTeamRef.current?.name ?? '?',
            device: ablyClient.auth.clientId?.slice(0, 6) ?? '?',
            clkOffset: Math.round(getClockOffsetMs()),
            recvDelay,
            revealT: serverNow(),
            path: 'SCHEDULED',
          })
        }
      }

      const delay = buzz_opened_at ? Math.max(0, buzz_opened_at - serverNow()) : 0
      if (delay > 0) revealTimerRef.current = setTimeout(reveal, delay)
      else reveal()
    })
    ch.subscribe('question_deactivated', () => {
      dtAutoBuzzedRef.current = null
      revealClaimRef.current = null
      if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null }
      sessionStorage.removeItem('buzzWindow')
      sessionStorage.removeItem('dtWager')
      setDtRevealForObserver(false)
      setDtTeammateWaiting(false)
      setPreBuzzTaps(0)
      setBuzzLockedOut(false)
      setBuzzFailed(false)
      setRoom(prev => prev ? {
        ...prev,
        current_question_id: null,
        buzz_opened_at: null,
        pending_question_id: null,
        pending_selection_team_id: null,
        pending_selection_session_id: null,
        pending_selection_claimed_at: null,
        pending_selection_wager: null,
      } : prev)
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
    ch.subscribe('question_selection_cleared', () => {
      if (selectionNoticeTimerRef.current) clearTimeout(selectionNoticeTimerRef.current)
      sessionStorage.removeItem('dtWager')
      setPreviewInfo(null)
      setDoubleTapTeamId(null)
      setDoubleTapStep(null)
      setDoubleTapPendingQ(null)
      setDtRevealForObserver(false)
      setDtTeammateWaiting(false)
      setSelectionNotice(null)
      setRoom(prev => prev ? {
        ...prev,
        pending_question_id: null,
        pending_selection_team_id: null,
        pending_selection_session_id: null,
        pending_selection_claimed_at: null,
        pending_selection_wager: null,
      } : prev)
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
      // Someone buzzed in and answered (right or wrong) → lift a spam lockout so a
      // locked-out device can buzz on the reopened window, per the "until another
      // player answers" rule.
      if (msg.winning_team_id || msg.wrong_buzz_id) {
        setBuzzLockedOut(false)
        setPreBuzzTaps(0)
      }
      // Set buzz feedback via broadcast (reliable) — fires before question_deactivated clears myBuzzId
      if (msg.winning_team_id && msg.winning_team_id === myTeamRef.current?.id) {
        setBuzzResult('correct')
      } else if (msg.wrong_buzz_id && (
        msg.wrong_buzz_id === myBuzzIdRef.current ||
        msg.wrong_buzz_id === timerBuzzIdRef.current
      )) {
        setBuzzResult('wrong')
        setTimerPayload(null) // prevent answer box / "Time's up!" from persisting for whole team
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
    ch.subscribe('category_reveal', ({ data }) => {
      const { revealed_ids, done } = data as { round: number; revealed_ids: string[]; done?: boolean }
      setCatRevealIds(done ? null : revealed_ids)
    })
    ch.subscribe('round_intermission', ({ data }) => {
      const { snapshots } = data as { snapshots: ScoreSnapshot[] }
      setIntermissionSnapshots(snapshots)
      setIntermissionSelectedId(undefined) // fresh chart re-defaults to my team
      // Broadcast-only state — persist so an accidental refresh restores the
      // chart instead of dumping the player back on the finished board.
      const r = roomRef.current
      if (r) sessionStorage.setItem('intermission', JSON.stringify({ roomId: r.id, status: r.status, snapshots }))
    })
    ch.subscribe('intermission_closed', () => {
      setIntermissionSnapshots(null)
      sessionStorage.removeItem('intermission')
    })
    ch.subscribe('game_state_change', ({ data }) => {
      const { status, fj_category } = data as { status: string; fj_category?: string }
      const r = roomRef.current
      if (!r) return
      setRoom({ ...r, status: status as Room['status'] })
      if (status === 'round_1' || status === 'round_2') {
        // Round 2 opener — quick splash on every phone so the room flips together
        if (status === 'round_2') {
          setPlayerRoundSplash(true)
          navigator.vibrate?.([80, 40, 80])
          setTimeout(() => setPlayerRoundSplash(false), 2600)
        }
        // New round — wipe all mid-game state
        setIntermissionSnapshots(null)
        sessionStorage.removeItem('intermission')
        setCatRevealIds(null) // host re-inits the reveal for the new round if it has one
        setBuzzFailed(false)
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
        setDtTeammateWaiting(false)
        setPreBuzzTaps(0)
        setBuzzLockedOut(false)
        revealClaimRef.current = null
        if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null }
        sessionStorage.removeItem('dtWager')
        loadBoard(r.id, status === 'round_2' ? 2 : 1)
        return
      }
      if (status === 'final_jeopardy') {
        setIntermissionSnapshots(null)
        sessionStorage.removeItem('intermission')
        setFjCategoryName(fj_category ?? 'Final Tap')
        setFjWagerInput(''); setFjWagerId(null); setFjLockedWagerAmount(null); setFjQuestion(null)
        setFjResponse(''); setFjResponseSubmitted(false); setFjResponseSubmitting(false); setFjResponseError('')
        setFjResponseDeadline(null); setFjTimeRemaining(null); setFjFinalScores([])
        fjResponseSubmitInFlightRef.current = false
        fjAutoSubmitStartedRef.current = false
        setFjSubPhase('incoming')
      }
    })
    ch.subscribe('fj_question_revealed', async ({ data }) => {
      const { question_id, start_ts, response_deadline_at, duration } = data as {
        question_id: string
        start_ts: number
        response_deadline_at?: number
        duration: number
      }
      const { data: q } = await supabase.from('questions_public').select().eq('id', question_id).single()
      setFjQuestion(q ?? null)
      setFjResponseError('')
      fjAutoSubmitStartedRef.current = false
      setFjResponseDeadline(response_deadline_at ?? start_ts + duration * 1000)
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
    ch.subscribe('fj_wager_locked', async ({ data }) => {
      const { team_id, wager_id, amount } = data as { team_id: string; wager_id?: string; amount?: number }
      if (team_id !== myTeamRef.current?.id) return
      // Teammate locked in a wager — sync wager_id and flip to locked screen
      if (wager_id) {
        setFjWagerId(wager_id)
        if (amount !== undefined) {
          setFjLockedWagerAmount(amount)
        } else {
          const { data: w } = await supabase.from('wagers').select('amount').eq('id', wager_id).single()
          if (w) setFjLockedWagerAmount(w.amount)
        }
      } else if (!fjWagerIdRef.current) {
        // Fallback: fetch from DB if wager_id wasn't in the broadcast
        const roomId = roomRef.current?.id
        if (roomId) {
          const { data: w } = await supabase.from('wagers').select('id, amount').eq('team_id', team_id).eq('room_id', roomId).maybeSingle()
          if (w) {
            setFjWagerId(w.id)
            setFjLockedWagerAmount(w.amount)
          }
        }
      }
      setFjSubPhase(prev => prev === 'wager' ? 'wager_locked' : prev)
    })
    ch.subscribe('fj_timer_expired', () => {
      // Auto-submit whatever the player has typed
      void submitFinalResponse(fjResponseRef.current)
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
      sessionStorage.removeItem('dtWager')
      setPreviewInfo(null); setActiveQuestion(null); setCurrentTurnTeamId(null)
      setTimerPayload(null); setBuzzWindowTs(null); setHasBuzzed(false); setMyBuzzId(null); setBuzzPosition(null); setBuzzResult(null)
      setDoubleTapTeamId(null); setDtRevealForObserver(false); setDtTeammateWaiting(false)
      setPreBuzzTaps(0); setBuzzLockedOut(false)
      revealClaimRef.current = null
      if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null }
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
    return () => {
      ch.unsubscribe()
      broadcastRef.current = null
      if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null }
    }
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

  // Persisted Final Tap recovery. Broadcasts move live clients immediately; these room fields
  // put refreshed or reconnected phones back into the same phase and original deadline.
  useEffect(() => {
    if (room?.status !== 'final_jeopardy') return
    const myId = myTeam?.id
    if (!myId) return
    let cancelled = false

    ;(async () => {
      const [{ data: team }, { data: category }, { data: wager }] = await Promise.all([
        supabase.from('teams').select().eq('id', myId).single(),
        supabase.from('categories').select('id, name').eq('room_id', room.id).eq('round', 3).single(),
        supabase.from('wagers').select().eq('room_id', room.id).eq('team_id', myId).maybeSingle(),
      ])
      if (cancelled || !team) return

      setMyTeam(team)
      setMyScore(team.score)
      setFjCategoryName(category?.name ?? 'Final Tap')
      if (wager) {
        setFjWagerId(wager.id)
        setFjLockedWagerAmount(wager.amount)
        if (wager.response) setFjResponse(wager.response)
        setFjResponseSubmitted(wager.submitted_at !== null)
      }

      const persistedPhase = room.final_phase ?? 'starting'
      if (!team.is_active) {
        setFjSubPhase('done')
        return
      }
      if (persistedPhase === 'starting') {
        setFjSubPhase('incoming')
        return
      }
      if (persistedPhase === 'wager') {
        setFjSubPhase(wager ? 'wager_locked' : 'wager')
        return
      }
      if (persistedPhase === 'question' && room.final_question_id && room.final_response_deadline_at) {
        const { data: question } = await supabase
          .from('questions_public')
          .select()
          .eq('id', room.final_question_id)
          .single()
        if (cancelled) return
        const deadline = new Date(room.final_response_deadline_at).getTime()
        setFjQuestion(question ?? null)
        setFjResponseError('')
        fjAutoSubmitStartedRef.current = false
        setFjResponseDeadline(deadline)
        setFjTimeRemaining(Math.max(0, Math.ceil((deadline - serverNow()) / 1000)))
        setFjSubPhase(deadline > serverNow() ? 'question' : 'reviewing')
        return
      }
      if (persistedPhase === 'review') {
        setFjSubPhase('reviewing')
      }
    })()

    return () => { cancelled = true }
  }, [
    room?.status,
    room?.final_phase,
    room?.final_question_id,
    room?.final_response_deadline_at,
    myTeam?.id,
  ]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-clear correct/wrong feedback after 2.5 s
  useEffect(() => {
    if (!buzzResult) return
    const id = setTimeout(() => setBuzzResult(null), 2500)
    return () => clearTimeout(id)
  }, [buzzResult])

  // Game over: the winning team's phones get confetti + a victory buzz
  useEffect(() => {
    if (fjSubPhase !== 'done' || fjFinalScores.length === 0) return
    const winner = [...fjFinalScores].sort((a, b) => b.score - a.score)[0]
    if (winner && winner.id === myTeamRef.current?.id) {
      setShowConfetti(true)
      navigator.vibrate?.([100, 50, 100, 50, 300])
    }
  }, [fjSubPhase, fjFinalScores])

  // Fallback: restore the persisted buzzer-open time. If an old room lacks one,
  // fail closed instead of granting a fresh 25-second window after refresh.
  useEffect(() => {
    if (!activeQuestion || doubleTapTeamId || buzzWindowTs) return
    if (room?.buzz_opened_at) {
      setBuzzWindowTs(new Date(room.buzz_opened_at).getTime())
      return
    }
    try {
      const saved = sessionStorage.getItem('buzzWindow')
      if (saved) {
        const { questionId, ts } = JSON.parse(saved) as { questionId: string; ts: number }
        if (questionId === activeQuestion.id) { setBuzzWindowTs(ts); return }
      }
    } catch {}
    setBuzzWindowTs(serverNow() - 25_000)
  }, [activeQuestion, doubleTapTeamId, buzzWindowTs, room?.buzz_opened_at])

  // Fallback: if page was refreshed during DT wager phase, restore the appropriate screen from sessionStorage.
  useEffect(() => {
    if (activeQuestion || doubleTapTeamId || !myTeam || !room || room.current_question_id) return
    try {
      const saved = sessionStorage.getItem('dtWager')
      if (!saved) return
      const { selectorTeamId, questionId: savedQId, isInitiator, roomId: savedRoomId } = JSON.parse(saved) as { selectorTeamId: string; questionId: string; isInitiator: boolean; roomId?: string }
      if (savedRoomId && savedRoomId !== room.id) { sessionStorage.removeItem('dtWager'); return }
      setDoubleTapTeamId(selectorTeamId)
      if (selectorTeamId === myTeam.id && isInitiator) {
        setDoubleTapPendingQ({ questionId: savedQId, rect: new DOMRect() })
        setDoubleTapWagerInput('')
        setDoubleTapStep('wager')
      } else if (selectorTeamId === myTeam.id) {
        setDtTeammateWaiting(true)
      } else {
        setDtRevealForObserver(true)
      }
    } catch {}
  }, [activeQuestion, doubleTapTeamId, myTeam?.id, room?.current_question_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Buzz window countdown (25s from when host opened buzzer)
  useEffect(() => {
    if (!buzzWindowTs) { setBuzzWindowRemaining(null); return }
    const BUZZ_WINDOW = 25
    const tick = () => {
      // buzzWindowTs is server-clock time — compare against serverNow(), not Date.now()
      const remaining = Math.max(0, Math.floor(
        (buzzWindowTs + BUZZ_WINDOW * 1000 - serverNow()) / 1000
      ))
      setBuzzWindowRemaining(remaining)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [buzzWindowTs])

  // Timer countdown
  useEffect(() => {
    if (!timerPayload) { setTimeRemaining(null); return }

    // `id` must be declared before tick() runs: restoring into an ALREADY-expired
    // answer window makes the first tick hit remaining === 0, and a `const id`
    // below would throw (TDZ) and blank the player screen mid-question.
    let id: ReturnType<typeof setInterval> | null = null
    const tick = () => {
      const remaining = Math.max(0, Math.floor(
        (timerPayload.start_timestamp + timerPayload.duration_seconds * 1000 - serverNow()) / 1000
      ))
      setTimeRemaining(remaining)
      if (remaining === 0 && id) { clearInterval(id); id = null }
      return remaining
    }

    if (tick() > 0) id = setInterval(tick, 500)
    return () => { if (id) clearInterval(id) }
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
      const claim = await claimTeamBuzz(qId, team.id)
      if (!claim) return
      const { buzz, created } = claim
      setMyBuzzId(buzz.id)
      setHasBuzzed(true)
      setBuzzWasMine(created)
      // Set timer locally so the answer box appears immediately without waiting for host broadcast
      setTimerPayload({
        start_timestamp: new Date(buzz.response_deadline_at).getTime() - 40_000,
        duration_seconds: 40,
        team_id: team.id,
        buzz_id: buzz.id,
        team_name: team.name,
      })
    })()
  }, [activeQuestion, doubleTapTeamId, myTeam?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // FJ 90-second countdown. Lock the current text just before the database deadline so
  // the request can arrive on time; Supabase still decides whether it was accepted.
  useEffect(() => {
    if (fjSubPhase !== 'question' || fjResponseDeadline === null) return
    const tick = () => {
      const millisecondsRemaining = fjResponseDeadline - serverNow()
      const remaining = Math.max(0, Math.ceil(millisecondsRemaining / 1000))
      setFjTimeRemaining(remaining)
      if (
        millisecondsRemaining > 0
        && millisecondsRemaining <= 750
        && !fjResponseSubmitted
        && !fjAutoSubmitStartedRef.current
      ) {
        fjAutoSubmitStartedRef.current = true
        void submitFinalResponse(fjResponseRef.current).then(saved => {
          if (!saved && fjResponseDeadline > serverNow()) {
            fjAutoSubmitStartedRef.current = false
          }
        })
      }
      if (millisecondsRemaining <= 0) {
        setFjSubPhase('reviewing')
        return true
      }
      return false
    }
    let id: ReturnType<typeof setInterval> | null = null
    if (!tick()) id = setInterval(tick, 250)
    return () => { if (id) clearInterval(id) }
  }, [fjSubPhase, fjResponseDeadline, fjResponseSubmitted, submitFinalResponse])

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

  async function claimTeamBuzz(questionId: string, teamId: string): Promise<{ buzz: Buzz; created: boolean } | null> {
    const { data: createdBuzz, error: insertError } = await supabase
      .from('buzzes')
      .insert({ question_id: questionId, team_id: teamId, status: 'pending' })
      .select()
      .single()

    if (createdBuzz) return { buzz: createdBuzz, created: true }
    if (insertError?.code !== '23505') return null

    const { data: existingBuzz } = await supabase
      .from('buzzes')
      .select()
      .eq('question_id', questionId)
      .eq('team_id', teamId)
      .single()

    return existingBuzz ? { buzz: existingBuzz, created: false } : null
  }

  async function handleJoinLobby() {
    if (!room) return
    const { data: teamData } = await supabase
      .from('teams').select().eq('room_id', room.id).order('created_at', { ascending: true })
    setTeams(teamData ?? [])
    setPhase('select_team')
  }

  // Load the team list before either branch: the team path needs it to show
  // joinable teams, the solo path needs it to spot a duplicate name.
  async function loadTeamsThen(next: Phase) {
    if (!room) return
    setError('')
    const { data: teamData } = await supabase
      .from('teams').select().eq('room_id', room.id).order('created_at', { ascending: true })
    setTeams(teamData ?? [])
    setPhase(next)
  }

  async function handleSoloJoin() {
    const name = soloName.trim()
    if (!name || !room) return
    // Team names are not unique in the schema, so two solo players sharing a first
    // name would put two identical rows on the projector. Catch it here instead.
    if (teams.some(t => t.name.trim().toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" is already on the board — add a last initial or something to tell you apart.`)
      return
    }
    setLoading(true); setError('')
    const { data: team, error: err } = await supabase
      .from('teams').insert({ room_id: room.id, name }).select().single()
    if (!team || err) { setLoading(false); setError('Could not get you in. Check your connection and try again.'); return }
    // A solo player IS their team: the one name they typed is both the team name
    // on the projector and their own nickname. Passed explicitly because the
    // setNickname below has not applied yet when joinTeam inserts.
    setNickname(name)
    await joinTeam(team, name)
  }

  async function handleLeave() {
    setLoading(true)
    setError('')
    const leavingTeamId = myTeam?.id ?? null
    const { error: leaveError } = await supabase
      .from('players')
      .delete({ count: 'exact' })
      .eq('session_id', getSessionId())
    setLoading(false)

    if (leaveError) {
      setError('Could not leave the team. Check your connection and try again.')
      return
    }

    // The database subscription is authoritative; this broadcast makes the host update
    // immediately while the existing poll remains a recovery path for missed events.
    if (room?.id) {
      void ablyClient.channels.get(`room:${room.id}`).publish('player_left', {
        team_id: leavingTeamId,
      }).catch(() => undefined)
    }

    clearPlayerSession()
    setMyTeam(null); setTeammates([])
    setActiveQuestion(null); setHasBuzzed(false)
    setMyBuzzId(null); setTimerPayload(null)
    setBuzzResult(null); setMyScore(0)
    setError('')
    // Back to the Team-or-Solo choice: dropping a solo player straight into the
    // team picker is exactly the confusion this flow exists to remove.
    setSoloName('')
    setPhase('choose_mode')
  }

  async function joinTeam(team: Team, nicknameOverride?: string) {
    setLoading(true); setError('')
    const { data: player, error: err } = await supabase
      .from('players')
      .insert({ team_id: team.id, session_id: getSessionId(), nickname: (nicknameOverride ?? nickname).trim() || null })
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
    const name = newTeamName.trim()
    // Same guard as the solo path: nothing in the schema stops two identical team
    // names, and two matching rows on the projector is exactly the confusion this
    // flow is meant to remove.
    if (teams.some(t => t.name.trim().toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" is already taken — pick another name.`)
      return
    }
    setLoading(true)
    const { data: team, error: err } = await supabase
      .from('teams').insert({ room_id: room.id, name: newTeamName.trim() }).select().single()
    if (!team || err) { setLoading(false); setError('Failed to create team. Try again.'); return }
    await joinTeam(team)
  }

  async function handleSubmitBuzz() {
    if (!myTeam || !room?.current_question_id || hasBuzzed || buzzing) return
    if (buzzWindowRemaining === 0) return
    if (buzzLockedOut) return // spam-tapped the preview screen — sit this question out
    setBuzzing(true)
    const qId = room.current_question_id
    const claim = await claimTeamBuzz(qId, myTeam.id)
    if (!claim) {
      // The single worst silent failure at a live event: player thinks they're in
      // the queue but the insert never landed. Tell them, buzz-able immediately.
      setBuzzing(false)
      setBuzzFailed(true)
      navigator.vibrate?.([60, 40, 60])
      return
    }
    const { buzz, created } = claim
    setBuzzFailed(false)
    // Count buzzes at or before ours to get queue position
    const { count } = await supabase
      .from('buzzes')
      .select('*', { count: 'exact', head: true })
      .eq('question_id', qId)
      .lte('buzzed_at', buzz.buzzed_at)
    setMyBuzzId(buzz.id)
    setHasBuzzed(true)
    setBuzzWasMine(created)
    setBuzzPosition(count)
    setBuzzing(false)

    if (!created) {
      setTimerPayload({
        start_timestamp: new Date(buzz.response_deadline_at).getTime() - 15_000,
        duration_seconds: 15,
        team_id: myTeam.id,
        buzz_id: buzz.id,
        team_name: myTeam.name,
      })
      return
    }
    // Start the server-deadline answer timer locally and broadcast for teammates/projector
    const startTs = new Date(buzz.response_deadline_at).getTime() - 15_000
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

  // Anti-spam: count taps on the pre-buzzer (preview) screen. 3 taps before the buzzer
  // appears = this device is locked out of buzzing until another player answers.
  function handlePreBuzzTap() {
    if (buzzLockedOut) return
    const SPAM_TAPS = 3
    const SPAM_WINDOW_MS = 1500
    const now = Date.now()
    // Self-expiring window: taps older than the window drop out on their own, so
    // this needs no reset alongside the other per-question state.
    const recent = [...preBuzzTapTimesRef.current, now].filter(t => now - t <= SPAM_WINDOW_MS)
    preBuzzTapTimesRef.current = recent
    setPreBuzzTaps(recent.length)
    if (recent.length >= SPAM_TAPS) setBuzzLockedOut(true)
  }

  function fireBuzz(clientX: number, clientY: number, target: HTMLButtonElement) {
    const rect = target.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const id = Date.now()
    setRipples(prev => [...prev, { id, x, y }])
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 900)
    playBuzz()
    navigator.vibrate?.(100)
    handleSubmitBuzz()
  }

  // The buzz fires on pointerDOWN — the instant the finger lands — so iOS can't
  // swallow the tap as a scroll gesture or delay it until the finger lifts.
  // (Players reported taps "not registering" when a touch drifted into a slide.)
  const lastPointerBuzzRef = useRef(0)
  function handleBuzzPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    lastPointerBuzzRef.current = Date.now()
    fireBuzz(e.clientX, e.clientY, e.currentTarget)
  }
  // Keyboard activation (Enter/Space) arrives as a click with no preceding pointer
  function handleBuzzClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (Date.now() - lastPointerBuzzRef.current < 700) return
    fireBuzz(e.clientX, e.clientY, e.currentTarget)
  }

  async function handleSubmitResponse() {
    const buzzId = myBuzzId ?? timerPayload?.buzz_id
    if (!buzzId || !responseText.trim()) return
    responseSubmittedRef.current = true // guard before await to prevent duplicate taps on this phone
    const { data: submitted, error: submitError } = await supabase.from('buzzes').update({
      response: responseText.trim(),
      response_submitted_at: new Date().toISOString(),
    }).eq('id', buzzId).is('response_submitted_at', null).select().maybeSingle()

    if (submitError) {
      responseSubmittedRef.current = false
      if (submitError.message.includes('Response window has closed')) {
        setTimeRemaining(0)
      }
      return
    }

    if (!submitted) {
      const { data: existing } = await supabase
        .from('buzzes').select('response').eq('id', buzzId).single()
      if (existing?.response) setResponseText(existing.response)
      setResponseSubmitted(true)
      return
    }

    setResponseSubmitted(true)
    broadcastRef.current?.publish('team_answer_submitted', {
      team_id: myTeam?.id,
      buzz_id: buzzId,
      buzzPosition,
      response: responseText.trim(),
    })
  }

  function showSelectionNotice(message: string) {
    if (selectionNoticeTimerRef.current) clearTimeout(selectionNoticeTimerRef.current)
    setSelectionNotice(message)
    selectionNoticeTimerRef.current = setTimeout(() => setSelectionNotice(null), 3500)
  }

  function questionSelectionLabel(questionId: string | null) {
    if (!questionId) return 'another clue'
    const category = boardCategories.find(c => c.questions.some(q => q.id === questionId))
    const question = category?.questions.find(q => q.id === questionId)
    const points = question?.point_value != null ? ` for ${question.point_value}` : ''
    return category ? `${category.name}${points}` : 'another clue'
  }

  async function claimQuestionSelection(questionId: string) {
    if (!room || !myTeam || selectionClaimingRef.current) return null
    selectionClaimingRef.current = true
    setSelectionClaiming(true)
    const { data, error } = await supabase.rpc('claim_question_selection', {
      p_room_id: room.id,
      p_team_id: myTeam.id,
      p_question_id: questionId,
      p_session_id: getSessionId(),
    })
    selectionClaimingRef.current = false
    setSelectionClaiming(false)

    const result = data?.[0]
    if (error || !result) {
      showSelectionNotice('That pick did not go through — try again.')
      return null
    }
    if (!result.accepted) {
      showSelectionNotice(
        result.question_id
          ? `Your teammate already picked ${questionSelectionLabel(result.question_id)}.`
          : 'That clue is no longer available.',
      )
      return null
    }

    setRoom(prev => prev ? {
      ...prev,
      pending_question_id: result.question_id,
      pending_selection_team_id: result.selecting_team_id,
      pending_selection_session_id: result.selector_session_id,
      pending_selection_claimed_at: result.claimed_at,
      pending_selection_wager: null,
    } : prev)
    return result
  }

  async function handleSelectQuestion(questionId: string, el: HTMLElement) {
    if (!room || !myTeam || currentTurnTeamId !== myTeam.id || selectionClaimingRef.current) return
    const cat = boardCategories.find(c => c.questions.some(q => q.id === questionId))
    const q   = cat?.questions.find(q => q.id === questionId)
    if (!q) return
    const rect = el.getBoundingClientRect()
    const claim = await claimQuestionSelection(questionId)
    if (!claim) return

    if (q?.is_double_tap) {
      // Fire question_preview immediately so all observers see the DT reveal at tile-tap time.
      // A second question_preview with the real wager fires after wager is confirmed.
      const team = myTeamRef.current
      if (team) {
        // Mark this device as the initiator BEFORE broadcasting so the echo doesn't overwrite the flag.
        sessionStorage.setItem('dtWager', JSON.stringify({ selectorTeamId: team.id, questionId, isInitiator: true, roomId: room.id }))
        broadcastRef.current?.publish('question_preview', {
          questionId,
          categoryName: cat?.name ?? '',
          pointValue: q.point_value ?? null,
          startTs: Date.now(),
          selectorTeamId: team.id,
          selectorSessionId: getSessionId(),
          doubleTapPending: true,
        })
      }
      setDoubleTapPendingQ({ questionId, rect })
      setDoubleTapWagerInput('')
      setDoubleTapStep('reveal')
      playDoubleTap()
      navigator.vibrate?.(200)
      setTimeout(() => setDoubleTapStep('wager'), 2000)
      return
    }

    _fireQuestionSelect(questionId, rect, null)
  }

  function _fireQuestionSelect(questionId: string, elOrRect: HTMLElement | DOMRect | null, wager: number | null) {
    const cat = boardCategories.find(c => c.questions.some(q => q.id === questionId))
    const q   = cat?.questions.find(q => q.id === questionId)
    const preview: PreviewInfo = {
      questionId,
      categoryName: cat?.name ?? '',
      pointValue:   q?.point_value ?? null,
      startTs:      Date.now(),
      ...(wager !== null ? { doubleTapWager: wager } : {}),
      answer:       q?.answer ?? '',
    }
    const rect = elOrRect instanceof HTMLElement ? elOrRect.getBoundingClientRect() : elOrRect
    setTileRect(rect)
    broadcastRef.current?.publish('question_preview', {
      ...preview,
      ...(myTeam ? { selectorTeamId: myTeam.id, selectorSessionId: getSessionId() } : {}),
    })
    setFlippingId(questionId)
    setTimeout(() => setPreviewInfo(preview), 600)
    setTimeout(() => setFlippingId(null), 650)
  }

  async function handleConfirmDoubleTapWager() {
    if (!doubleTapPendingQ || !room || !myTeam) return
    const roundFloor = room?.status === 'round_2' ? 2000 : 500
    const max    = Math.max(myScore, roundFloor)
    const parsed = parseInt(doubleTapWagerInput)
    const wager  = Math.max(5, Math.min(max, isNaN(parsed) ? 5 : parsed))
    const { questionId, rect } = doubleTapPendingQ
    const { data: confirmed } = await supabase.rpc('confirm_question_selection', {
      p_room_id: room.id,
      p_team_id: myTeam.id,
      p_question_id: questionId,
      p_session_id: getSessionId(),
      p_wager: wager,
    })
    if (!confirmed) {
      setDoubleTapStep(null)
      setDoubleTapPendingQ(null)
      // Rejected either because the host undid the pick, or because a teammate
      // (or a host override) locked a wager first — only the undo needs a notice.
      const { data: r } = await supabase.from('rooms')
        .select('pending_question_id, pending_selection_wager')
        .eq('id', room.id).single()
      if (!(r?.pending_question_id === questionId && r.pending_selection_wager != null)) {
        showSelectionNotice('That pick was undone by the host.')
      }
      return
    }
    setRoom(prev => prev ? { ...prev, pending_selection_wager: wager } : prev)
    setDoubleTapStep(null)
    setDoubleTapPendingQ(null)
    // Brief board flash, then overlay opens
    setTileRect(rect)
    _fireQuestionSelect(questionId, rect, wager)
  }

  async function handleSubmitWager() {
    if (!myTeam || !room) return
    const amount = Math.max(0, Math.min(Math.max(0, myScore), parseInt(fjWagerInput) || 0))
    const { data: wager, error: insertError } = await supabase
      .from('wagers').insert({ team_id: myTeam.id, room_id: room.id, amount, status: 'pending' })
      .select().single()

    let teamWager = wager
    if (!teamWager && insertError?.code === '23505') {
      const { data: existing } = await supabase
        .from('wagers').select().eq('team_id', myTeam.id).eq('room_id', room.id).single()
      teamWager = existing
    }
    if (!teamWager) return

    setFjWagerId(teamWager.id)
    setFjWagerInput(String(teamWager.amount))
    setFjLockedWagerAmount(teamWager.amount)
    setFjSubPhase('wager_locked')
    if (wager) {
      broadcastRef.current?.publish('fj_wager_locked', {
        team_id: myTeam.id,
        wager_id: teamWager.id,
        amount: teamWager.amount,
      })
    }
  }

  async function handleSubmitFJResponse() {
    if (!fjResponse.trim()) return
    await submitFinalResponse(fjResponse)
  }

  // ── Derived ───────────────────────────────────────────────

  const isMyTurnNow  = myTeam?.id === currentTurnTeamId
  const turnTeamName = currentTurnTeamId ? teamNames.get(currentTurnTeamId) : null

  // ── Score chip ────────────────────────────────────────────

  // Sizing an answer screen to the visible viewport (rather than 100vh) keeps the
  // text box and submit button above an open keyboard; the clue card above them
  // scrolls internally instead of pushing them off screen.
  const answerScreenStyle = viewportHeight ? { height: `${viewportHeight}px`, minHeight: 0 } : undefined

  // Enter drops the keyboard but deliberately does NOT submit: a stray Enter would
  // otherwise lock in a half-typed answer, and submissions are one-shot. Closing the
  // keyboard reveals the submit button, so the tap that follows is the confirmation.
  const dismissKeyboardOnEnter = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    e.currentTarget.blur()
  }

  const scoreChip = (
    <button
      onClick={() => setShowScoreOverlay(true)}
      className={`absolute top-4 right-4 bg-[#17120b]/90 border border-amber-500/20 shadow-lg shadow-black/40 backdrop-blur-sm rounded-2xl px-3 py-2 text-right z-10 ${scoreChipPulse ? 'score-chip-pulse' : ''}`}
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
      <div className="min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6">
        <PintHero className="w-16 h-24 mb-6 opacity-90" />
        <p className="text-amber-200/70 text-lg animate-pulse">Finding game…</p>
      </div>
    )
  }

  if (phase === 'no_lobby') {
    return (
      <div className="min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6 text-center">
        <Bubbles />
        <div className="relative z-10 flex flex-col items-center">
          <PintHero className="w-20 h-32 mb-5" />
          <h1 className="neon-title text-5xl font-black mb-4 tracking-tight">Tapped In!</h1>
          <p className="text-amber-100/70 animate-pulse">Waiting for host to open a lobby…</p>
          <p className="text-gray-600 text-sm mt-2">This page will update automatically.</p>
          <QuipCycler />
        </div>
      </div>
    )
  }

  // Team-or-Solo choice. Split out because a single "nickname" box followed by a
  // separate "team name" box read as the same question asked twice, and players
  // regularly filled one in expecting it to be the other.
  if (phase === 'choose_mode' && room) {
    return (
      <div className="min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6 text-center">
        <Bubbles />
        <div className="relative z-10 w-full max-w-sm flex flex-col items-center">
          <PintHero className="w-16 h-24 mb-4" />
          <h1 className="neon-title text-5xl font-black mb-6 tracking-tight">Tapped In!</h1>
          {/* No "tonight's game" card: only one game runs at a time, so naming it
              told players nothing and pushed the second choice off short screens. */}
          <p className="text-amber-300 font-black text-lg mb-4">How are you playing?</p>

          {/* Two different pours so the choice reads at a glance, not just from the
              label. Equal min-height keeps them balanced even though only one
              carries a subtitle. */}
          <button
            onClick={() => loadTeamsThen('join_lobby')}
            className="active:scale-[0.99] w-full rounded-2xl px-5 py-6 mb-3 flex flex-col items-center justify-center gap-2 border-2 transition-all"
            style={{
              minHeight: '11rem',
              borderColor: 'rgba(251,191,36,0.55)',
              background: 'linear-gradient(180deg, rgba(251,191,36,0.14), rgba(251,191,36,0.04))',
              animation: 'slide-up-in 0.4s ease-out 0.1s both',
            }}
          >
            <CheersPints className="w-24 h-14" from="#fde68a" to="#d97706" />
            <p className="font-black text-2xl text-amber-100">With a team</p>
            <p className="text-amber-200/70 text-sm">Play with friends!</p>
          </button>

          <button
            onClick={() => loadTeamsThen('solo_name')}
            className="active:scale-[0.99] w-full rounded-2xl px-5 py-6 flex flex-col items-center justify-center gap-2 border-2 transition-all"
            style={{
              minHeight: '11rem',
              borderColor: 'rgba(45,212,191,0.5)',
              background: 'linear-gradient(180deg, rgba(45,212,191,0.12), rgba(45,212,191,0.03))',
              animation: 'slide-up-in 0.4s ease-out 0.18s both',
            }}
          >
            <SoloPint className="w-12 h-14" from="#99f6e4" to="#0d9488" />
            <p className="font-black text-2xl text-teal-100">On my own</p>
          </button>
        </div>
      </div>
    )
  }

  // Solo: ONE name, which becomes both the team on the projector and the nickname.
  if (phase === 'solo_name' && room) {
    return (
      <div className="min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6 text-center">
        <Bubbles />
        <div className="relative z-10 w-full max-w-sm flex flex-col items-center">
          <PintHero className="w-16 h-24 mb-4" />
          <h1 className="neon-title text-4xl font-black mb-2 tracking-tight">Playing solo</h1>
          <p className="text-gray-400 text-sm mb-8 leading-snug">
            This is the name everyone sees on the big screen.
          </p>
          <input
            type="text"
            placeholder="Your name"
            value={soloName}
            onChange={e => { setSoloName(e.target.value); if (error) setError('') }}
            onKeyDown={e => e.key === 'Enter' && soloName.trim() && handleSoloJoin()}
            className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent text-center text-lg placeholder:text-gray-600"
            autoFocus
            maxLength={24}
          />
          {error && <p className="text-red-400 text-sm mb-4 leading-snug">{error}</p>}
          <button
            onClick={handleSoloJoin}
            disabled={loading || !soloName.trim()}
            className="btn-beer w-full py-4 rounded-2xl text-xl font-black mb-3"
          >
            {loading ? 'Getting you in…' : "Let's Go"}
          </button>
          <button
            onClick={() => { setError(''); setPhase('choose_mode') }}
            className="text-gray-500 text-sm py-2 hover:text-amber-300 transition-colors"
          >
            &lsaquo; Back
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'join_lobby' && room) {
    return (
      <div className="min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6 text-center">
        <Bubbles />
        <div className="relative z-10 w-full flex flex-col items-center">
          <PintHero className="w-16 h-24 mb-4" />
          <h1 className="neon-title text-5xl font-black mb-8 tracking-tight">Tapped In!</h1>
          {/* Spelling out that this is step 1 of 2, and what the OTHER name is for,
              is the whole point: the two boxes used to look like the same question. */}
          <p className="text-amber-300 font-black text-lg mb-1">First, your name</p>
          <p className="text-gray-400 text-sm mb-4 leading-snug max-w-sm">
            Just so your teammates know who you are. You&rsquo;ll name the team on the next screen.
          </p>
          <input
            type="text"
            placeholder="Your name"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && nickname.trim() && handleJoinLobby()}
            className="w-full max-w-sm bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent text-center text-lg placeholder:text-gray-600"
            autoFocus
            maxLength={24}
          />
          <button
            onClick={handleJoinLobby}
            disabled={!nickname.trim()}
            className="btn-beer w-full max-w-sm py-4 rounded-2xl text-xl font-black"
          >
            Next &rsaquo;
          </button>
          <button
            onClick={() => { setError(''); setPhase('choose_mode') }}
            className="text-gray-500 text-sm py-2 mt-3 hover:text-amber-300 transition-colors"
          >
            &lsaquo; Back
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'select_team') {
    return (
      <div className="min-h-screen bar-bg text-white flex flex-col p-6">
        <div className="relative z-10 max-w-sm mx-auto w-full pt-10">
          <h1 className="neon-title text-center text-4xl font-black mb-1">Tapped In!</h1>
          <p className="text-center text-amber-300 font-black text-lg mb-1">Now pick your team</p>
          <p className="text-center text-gray-500 text-sm mb-6">
            Start a new one, or tap a team a friend already made.
          </p>
          {!showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              className="w-full border-2 border-dashed border-amber-400/60 text-amber-300 rounded-xl px-4 py-3 font-bold mb-6 hover:bg-amber-400/10 active:bg-amber-400/15 transition-colors"
            >
              + Create New Team
            </button>
          ) : (
            <div className="space-y-2 mb-6">
              <input
                type="text"
                placeholder="Team name"
                value={newTeamName}
                onChange={e => { setNewTeamName(e.target.value); if (error) setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleCreateTeam()}
                autoFocus
                className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-gray-600"
              />
              <button
                onClick={handleCreateTeam}
                disabled={loading || !newTeamName.trim()}
                className="btn-beer w-full py-3 rounded-xl font-black"
              >
                {loading ? 'Creating…' : 'Create & Join'}
              </button>
            </div>
          )}
          {teams.length > 0 && (
            <>
              <p className="text-amber-400/80 text-sm uppercase tracking-wider font-black mb-3">Join a team</p>
              <div className="space-y-2 mb-4">
                {teams.map((team, i) => (
                  <button
                    key={team.id}
                    onClick={() => joinTeam(team)}
                    disabled={loading}
                    className="w-full glass-card hover:border-amber-400/40 active:scale-[0.99] rounded-xl px-4 py-3.5 text-left font-semibold transition-all flex items-center gap-3"
                    style={{ animation: `slide-up-in 0.35s ease-out ${i * 0.06}s both` }}
                  >
                    <span
                      className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center font-black text-amber-950"
                      style={{ background: 'linear-gradient(145deg, #fcd34d 0%, #f59e0b 60%, #c2650a 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)' }}
                    >
                      {team.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 truncate">{team.name}</span>
                    <span className="text-amber-500/60 text-lg">›</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {error && <p className="text-red-400 text-sm text-center mt-4">{error}</p>}
          <button
            onClick={() => { setError(''); setShowCreate(false); setPhase('choose_mode') }}
            className="w-full text-gray-500 text-sm py-2 mt-2 hover:text-amber-300 transition-colors"
          >
            &lsaquo; Back
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6 text-center">
        <Bubbles />
        <div className="relative z-10 flex flex-col items-center w-full">
          <span className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full bg-green-400/10 border border-green-400/30">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-300 text-xs font-bold uppercase tracking-wider">You're in</span>
          </span>
          <p className="text-gray-500 text-xs uppercase tracking-widest mb-1">Playing for</p>
          <h2 className="text-4xl font-black text-yellow-400 mb-2">{myTeam?.name}</h2>
          <p className="text-gray-500 text-sm mb-10">Waiting for the host to start the game…</p>
          {teammates.length > 0 && (
            <div className="glass-card rounded-2xl px-6 py-5 w-full max-w-xs">
              <p className="text-amber-400/80 text-xs uppercase tracking-[0.2em] mb-3">At the table</p>
              <div className="flex flex-wrap justify-center gap-2">
                {teammates.map(p => (
                  <span key={p.id} className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-white">
                    {p.nickname ?? 'Anonymous'}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button onClick={handleLeave} disabled={loading} className="mt-8 px-5 py-2 text-sm font-medium text-yellow-400 border border-yellow-500 rounded-lg hover:bg-yellow-500 hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Leaving…' : 'Leave Team'}
          </button>
          {error && <p className="text-red-400 text-sm text-center mt-3">{error}</p>}
          <QuipCycler />
        </div>
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
      <div className="min-h-screen final-bg text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <p className="text-6xl mb-6" style={{ animation: 'hero-float 3s ease-in-out infinite' }}>🍺</p>
        <p className="text-amber-400 text-xs uppercase tracking-widest mb-3">Final Tap</p>
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
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '300ms' }} />
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
      <div className="min-h-screen final-bg text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <p className="text-amber-400 text-xs uppercase tracking-widest mb-2">Final Tap</p>
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
            className="w-full bg-white/5 border border-white/10 text-white text-center text-5xl font-mono font-black rounded-2xl px-4 py-5 outline-none focus:ring-2 focus:ring-yellow-400"
          />
          {fjWagerInput !== '' && wagerVal !== parseInt(fjWagerInput) && (
            <p className="text-yellow-400 text-xs">Capped at {maxWager}</p>
          )}
          <button
            onClick={handleSubmitWager}
            disabled={!valid}
            className="btn-beer w-full py-4 rounded-2xl text-lg font-black"
          >
            Lock In Wager: {wagerVal} pts
          </button>
        </div>
      </div>
    )
  }

  if (fjSubPhase === 'wager_locked') {
    return (
      <div className="min-h-screen final-bg text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <div className="w-3 h-3 rounded-full bg-green-400 mb-6 animate-pulse" />
        <p className="text-2xl font-black text-white mb-2">Team wager locked in</p>
        {fjLockedWagerAmount !== null && (
          <p className="text-5xl font-mono font-black text-yellow-400 mb-3">{fjLockedWagerAmount} pts</p>
        )}
        <p className="text-gray-400 text-sm">Waiting for other teams…</p>
        <p className="text-amber-400 text-xs uppercase tracking-widest mt-10">{fjCategoryName}</p>
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
      <div className="min-h-screen final-bg text-white flex flex-col overflow-hidden" style={answerScreenStyle}>
        {scoreOverlayEl}
        {/* Timer bar */}
        <div className="h-2 bg-black/40 w-full shrink-0">
          <div
            className={`h-full transition-all duration-500 ${low ? 'bg-red-500' : 'bg-yellow-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex-1 min-h-0 flex flex-col p-5 max-w-sm mx-auto w-full">
          <div className="flex items-center justify-between mb-4 pt-3">
            <p className="text-amber-400 text-xs uppercase tracking-widest">Final Tap</p>
            <span className={`inline-block font-mono text-3xl font-black tabular-nums ${low ? 'text-red-400' : 'text-white'}`}
              style={low ? { animation: 'timer-pulse 0.8s ease-in-out infinite' } : undefined}>
              {remaining}
            </span>
          </div>
          <div className="glass-card rounded-2xl p-5 mb-4 min-h-0 overflow-y-auto">
            <p className="text-xs text-amber-400/70 uppercase tracking-[0.2em] mb-2">The Answer</p>
            <p className="text-xl font-bold leading-snug">{fjQuestion.answer}</p>
          </div>
          {fjResponseSubmitted ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-3 h-3 rounded-full bg-yellow-400 animate-pulse" />
              <p className="text-white font-black text-xl">Response submitted</p>
              <div className="glass-card rounded-2xl px-5 py-3 max-w-xs">
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
                onKeyDown={dismissKeyboardOnEnter}
                enterKeyHint="done"
                disabled={fjResponseSubmitting}
                maxLength={500}
                rows={2}
                className="w-full shrink-0 bg-white/5 border border-white/10 text-white rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-gray-600 resize-none text-lg mb-4"
              />
              {fjResponseError && (
                <p role="alert" className="text-red-400 text-sm text-center mb-3">{fjResponseError}</p>
              )}
              <button
                onClick={handleSubmitFJResponse}
                disabled={!fjResponse.trim() || fjResponseSubmitting}
                className="btn-beer w-full shrink-0 py-4 rounded-2xl font-black text-lg"
              >
                {fjResponseSubmitting ? 'Locking…' : 'Submit Response'}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  if (fjSubPhase === 'reviewing') {
    return (
      <div className="min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <div className="w-3 h-3 rounded-full bg-gray-600 mb-6 animate-pulse" />
        <p className="text-2xl font-black text-white mb-2">Time's up!</p>
        <p className="text-gray-500 text-sm">The host is reviewing answers…</p>
        <QuipCycler />
      </div>
    )
  }

  // Eliminated before Final Tap: 'done' with no final scores yet means the game is
  // still running for the top 3 — show a spectator screen instead of an empty podium.
  if (fjSubPhase === 'done' && fjFinalScores.length === 0 && !intermissionSnapshots) {
    return (
      <div className="min-h-screen final-bg text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <p className="text-5xl mb-5">🍻</p>
        <p className="text-amber-400 text-xs uppercase tracking-widest mb-2">Final Tap</p>
        <p className="text-2xl font-black text-white mb-3">Your night ends here</p>
        <p className="text-gray-300 leading-relaxed max-w-xs mb-6">
          The teams still in the black are battling it out — watch the big screen!
          Final standings will show up here when it's all over.
        </p>
        <p className="text-gray-400 text-sm">You finished with</p>
        <p className="text-4xl font-mono font-black text-yellow-400">{myScore.toLocaleString()} pts</p>
        <TipJar style={{ marginTop: '1.5rem', width: '100%', maxWidth: '20rem' }} />
        <QuipCycler />
      </div>
    )
  }

  if (fjSubPhase === 'done' && !intermissionSnapshots) {
    const finalStandings = [...fjFinalScores].sort((a, b) => b.score - a.score)
    const winner   = finalStandings[0]
    const myFinIdx = finalStandings.findIndex(t => t.id === myTeam?.id)
    const myEntry  = myFinIdx >= 0 ? finalStandings[myFinIdx] : null
    const iWon     = winner != null && winner.id === myTeam?.id
    const medals   = ['🥇', '🥈', '🥉']
    return (
      <div className="relative min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
        {scoreOverlayEl}
        <Confetti active={showConfetti} onDone={() => setShowConfetti(false)} />
        {iWon ? (
          <>
            <p className="text-6xl mb-4" style={{ animation: 'trophy-float 2.5s ease-in-out infinite' }}>🏆</p>
            <p className="text-gray-500 text-xs uppercase tracking-widest mb-2"
              style={{ animation: 'slide-up-in 0.4s ease-out both' }}>Game Over</p>
            <p className="text-5xl font-black text-yellow-400 mb-2 leading-tight"
              style={{ animation: 'pop-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both' }}>
              Champions!
            </p>
            <p className="text-gray-300 font-semibold mb-8"
              style={{ animation: 'slide-up-in 0.4s ease-out 0.4s both' }}>
              {winner.name} takes the night 🍻
            </p>
          </>
        ) : (
          <>
            <p className="text-gray-500 text-xs uppercase tracking-widest mb-2"
              style={{ animation: 'slide-up-in 0.4s ease-out both' }}>Game Over</p>
            <p className="text-3xl font-black text-yellow-400 mb-4"
              style={{ animation: 'pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both' }}>
              {winner?.name ?? '?'} wins!
            </p>
            {myEntry && (
              <div className="mb-6" style={{ animation: 'slide-up-in 0.5s ease-out 0.3s both' }}>
                <p className="text-gray-500 text-xs uppercase tracking-widest mb-0.5">You finished</p>
                <p className="text-5xl font-black text-white leading-none">{ordinal(myFinIdx + 1)}</p>
              </div>
            )}
          </>
        )}
        {finalStandings.length > 0 && (
          <div className="w-full max-w-xs space-y-2 mb-8">
            {finalStandings.map((t, i) => (
              <div key={t.id}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 ${t.id === myTeam?.id ? 'bg-yellow-400/10 border border-yellow-400/30' : 'glass-card'}`}
                style={{ animation: `slide-up-in 0.4s ease-out ${0.5 + i * 0.1}s both` }}>
                <span className="w-6 text-center shrink-0">
                  {i < 3 ? medals[i] : <span className="text-gray-600 font-mono text-sm">{i + 1}</span>}
                </span>
                <span className="flex-1 font-semibold text-left truncate">{t.name}</span>
                <span className={`font-mono font-black text-sm ${t.score < 0 ? 'text-red-400' : 'text-yellow-400'}`}>{t.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
        {myEntry && !iWon && (
          <p className="text-gray-400 text-sm">Your final score: <span className="text-white font-black">{myEntry.score.toLocaleString()}</span></p>
        )}
        <TipJar style={{ marginTop: '1.5rem', width: '100%', maxWidth: '20rem', animation: 'slide-up-in 0.4s ease-out 0.8s both' }} />
        <div className="w-full flex justify-center" style={{ marginTop: '1rem', animation: 'slide-up-in 0.4s ease-out 0.85s both' }}>
          <FeedbackForm roomId={room?.id} teamId={myTeam?.id} teamName={myTeam?.name} />
        </div>
        <VenueFooter style={{ marginTop: '1.5rem', animation: 'slide-up-in 0.4s ease-out 0.9s both' }} />
        <button onClick={handleLeave} disabled={loading} className="mt-6 px-5 py-2 text-sm font-medium text-yellow-400 border border-yellow-500 rounded-lg hover:bg-yellow-500 hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? 'Leaving…' : 'Leave'}
        </button>
        {error && <p className="text-red-400 text-sm text-center mt-3">{error}</p>}
      </div>
    )
  }

  // ── Round intermission — score history graph between rounds ──

  if (intermissionSnapshots) {
    const teamIds = allTeamScores.map(t => t.id)
    const teamNameMap = new Map(allTeamScores.map(t => [t.id, t.name]))
    // undefined = untouched → default the highlight to my own team
    const chartSelectedId = intermissionSelectedId === undefined ? (myTeam?.id ?? null) : intermissionSelectedId
    const toggleChartTeam = (id: string) =>
      setIntermissionSelectedId(chartSelectedId === id ? null : id)
    const standings = [...allTeamScores].sort((a, b) => b.score - a.score)
    const myIdx     = standings.findIndex(t => t.id === myTeam?.id)
    const leader    = standings[0]
    const myEntry   = myIdx >= 0 ? standings[myIdx] : null
    const gap       = myEntry && leader ? leader.score - myEntry.score : 0
    const medals    = ['🥇', '🥈', '🥉']
    const mapPhase: 'r1' | 'r2' | 'final' =
      fjSubPhase === 'done' || room?.status === 'finished' ? 'final'
        : room?.status === 'round_2' ? 'r2' : 'r1'
    return (
      <div className="min-h-screen bar-bg text-white flex flex-col p-5 overflow-y-auto">
        <div className="text-center mb-3 shrink-0">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1"
            style={{ animation: 'slide-up-in 0.4s ease-out both' }}>
            {mapPhase === 'final' ? 'The whole game, every swing'
              : mapPhase === 'r2' ? 'Round 2 in the books'
              : 'Round 1 in the books'}
          </p>
          <p className="text-3xl font-black text-yellow-400"
            style={{ animation: 'pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both' }}>
            {mapPhase === 'final' ? '🍻 The Final Pour' : mapPhase === 'r2' ? '🍻 Last Call' : '🍻 Halftime'}
          </p>
        </div>

        {/* Personal rank hero — the thing each player actually wants to know */}
        {myEntry && (
          <div className="text-center mb-3 shrink-0"
            style={{ animation: 'slide-up-in 0.5s ease-out 0.3s both' }}>
            <p className="text-gray-500 text-xs uppercase tracking-widest mb-0.5">You're in</p>
            <p className="text-5xl font-black text-white leading-none mb-1">{ordinal(myIdx + 1)}</p>
            <p className="text-sm font-semibold">
              {myIdx === 0 ? (
                standings.length > 1 && standings[1].score === myEntry.score
                  ? <span className="text-yellow-400">Tied for the lead!</span>
                  : <span className="text-yellow-400">Leading by {(myEntry.score - (standings[1]?.score ?? 0)).toLocaleString()}</span>
              ) : gap === 0 ? (
                <span className="text-yellow-400">Tied with the leader!</span>
              ) : (
                <span className="text-gray-400">{gap.toLocaleString()} behind the leader</span>
              )}
            </p>
          </div>
        )}

        <div className="shrink-0" style={{ height: '38vh', animation: 'slide-up-in 0.5s ease-out 0.45s both' }}>
          <ScoreHistoryChart
            snapshots={intermissionSnapshots}
            teamNames={teamNameMap}
            teamIds={teamIds}
            selectedTeamId={chartSelectedId}
            onSelectTeam={setIntermissionSelectedId}
          />
        </div>

        <div className="mt-3 space-y-2 shrink-0">
          {standings.map((t, i) => (
            <button key={t.id}
              onClick={() => toggleChartTeam(t.id)}
              className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left ${
                t.id === myTeam?.id ? 'bg-yellow-400/10 border border-yellow-400/30' : 'glass-card'
              }`}
              style={{
                animation: `slide-up-in 0.4s ease-out ${0.55 + i * 0.08}s both`,
                // Selected row echoes the chart highlight in the team's line color
                boxShadow: t.id === chartSelectedId ? `inset 0 0 0 2px ${getTeamColor(t.id, teamIds)}` : undefined,
              }}>
              <span className="w-6 text-center shrink-0">
                {i < 3 ? medals[i] : <span className="text-gray-600 font-mono text-sm">{i + 1}</span>}
              </span>
              <span className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: getTeamColor(t.id, teamIds) }} />
              <span className="flex-1 font-bold truncate">{t.name}</span>
              <span className={`font-mono font-black tabular-nums ${t.score < 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                {t.score.toLocaleString()}
              </span>
            </button>
          ))}
        </div>

        <TipJar style={{ marginTop: '1rem', animation: `slide-up-in 0.4s ease-out ${0.6 + standings.length * 0.08}s both` }} />

        <p className="text-center text-gray-500 text-sm mt-4 pb-4 shrink-0"
          style={{ animation: `slide-up-in 0.4s ease-out ${0.6 + standings.length * 0.08}s both` }}>
          {mapPhase === 'final' ? "That's the whole story. Cheers! 🍻"
            : mapPhase === 'r2' ? 'Final Tap is next — one question, wager what you dare 🍺'
            : 'Round 2 is coming — bigger points on the board. Refill while you can 🍺'}
        </p>
      </div>
    )
  }

  // ── Check buzzResult FIRST so feedback persists after question is cleared ──

  if (buzzResult === 'correct') {
    return (
      <div className="relative min-h-screen result-bg-correct text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        <Confetti active={showConfetti} onDone={() => setShowConfetti(false)} />
        {scoreChip}
        <div className="text-8xl mb-6 leading-none"
          style={{ animation: 'pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>✓</div>
        <p className="text-5xl font-black text-green-400 mb-3"
          style={{ animation: 'slide-up-in 0.4s ease-out 0.15s both' }}>Correct!</p>
        {activeQuestion?.point_value && (
          <p className="text-green-300 text-xl font-semibold"
            style={{ animation: 'slide-up-in 0.4s ease-out 0.3s both' }}>+{activeQuestion.point_value} points</p>
        )}
      </div>
    )
  }

  if (buzzResult === 'wrong') {
    return (
      <div className="relative min-h-screen result-bg-wrong text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <div style={{ animation: 'shake-x 0.5s ease-out 0.2s' }} className="flex flex-col items-center">
          <div className="text-8xl mb-6 leading-none"
            style={{ animation: 'pop-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>✗</div>
          <p className="text-5xl font-black text-red-400 mb-3">Wrong!</p>
          {activeQuestion?.point_value && (
            <p className="text-red-300 text-xl font-semibold">−{activeQuestion.point_value} points</p>
          )}
        </div>
        <p className="text-gray-500 text-sm mt-4"
          style={{ animation: 'slide-up-in 0.4s ease-out 0.5s both' }}>Waiting for other teams…</p>
      </div>
    )
  }

  // ── Double Tap reveal screens ─────────────────────────────

  // Which glass is being wagered on — the pick is public info, so every DT screen
  // shows it (players kept forgetting which category they'd chosen mid-wager)
  const dtPendingId   = doubleTapPendingQ?.questionId ?? room?.pending_question_id ?? null
  const dtPendingCat  = dtPendingId ? boardCategories.find(c => c.questions.some(q => q.id === dtPendingId)) : undefined
  const dtPendingQRow = dtPendingCat?.questions.find(q => q.id === dtPendingId)
  const dtPendingLabel = dtPendingCat
    ? `${dtPendingCat.name}${dtPendingQRow?.point_value != null ? ` — $${dtPendingQRow.point_value}` : ''}`
    : null

  if (doubleTapStep === 'reveal') {
    return (
      <div className="min-h-screen dt-bg text-white flex flex-col items-center justify-center p-6 text-center">
        <div style={{ animation: 'double-tap-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
          <p className="text-8xl mb-4">🍺</p>
          <p className="text-5xl font-black text-amber-400 leading-none mb-2">DOUBLE TAP!</p>
          {dtPendingLabel && <p className="text-white font-black text-2xl mb-2">{dtPendingLabel}</p>}
          <p className="text-amber-200 text-xl font-semibold">Get ready to wager!</p>
        </div>
      </div>
    )
  }

  // Other players see the DT reveal animation too, but locked out
  if (dtRevealForObserver) {
    const dtName = doubleTapTeamId ? (teamNames.get(doubleTapTeamId) ?? 'Another team') : 'Another team'
    return (
      <div className="min-h-screen dt-bg text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <div style={{ animation: 'double-tap-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
          <p className="text-8xl mb-4">🍺</p>
          <p className="text-5xl font-black text-amber-400 leading-none mb-2">DOUBLE TAP!</p>
          {dtPendingLabel && <p className="text-white font-black text-2xl mb-2">{dtPendingLabel}</p>}
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
      <div className="min-h-screen dt-bg text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <p className="text-5xl mb-4">🍺</p>
        <p className="text-3xl font-black text-amber-400 mb-1">DOUBLE TAP!</p>
        {dtPendingLabel && <p className="text-white font-black text-2xl mb-1">{dtPendingLabel}</p>}
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
            className="w-full bg-white/5 border border-white/10 text-white text-center text-5xl font-mono font-black rounded-2xl px-4 py-5 outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            onClick={handleConfirmDoubleTapWager}
            disabled={!valid}
            className="btn-beer w-full py-4 rounded-2xl text-lg font-black"
          >
            Lock In: {wagerVal} pts
          </button>
        </div>
      </div>
    )
  }

  // Teammates of the tile-clicker see the reveal too while the clicker wagers
  if (dtTeammateWaiting) {
    return (
      <div className="min-h-screen dt-bg text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <div style={{ animation: 'double-tap-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
          <p className="text-8xl mb-4">🍺</p>
          <p className="text-5xl font-black text-amber-400 leading-none mb-2">DOUBLE TAP!</p>
          {dtPendingLabel && <p className="text-white font-black text-2xl mb-2">{dtPendingLabel}</p>}
          <p className="text-amber-200 text-xl font-semibold">Your team is wagering!</p>
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
      <div className="min-h-screen bar-bg text-white flex flex-col">
        {scoreOverlayEl}
        {scoreChip}

        {selectionNotice && (
          <div className="fixed top-3 left-3 right-3 z-[110] rounded-xl border border-amber-400/50 bg-amber-950 px-4 py-3 text-center text-sm font-bold text-amber-200 shadow-xl"
            style={{ animation: 'banner-drop 0.25s ease-out both' }}>
            {selectionNotice}
          </div>
        )}

        {/* Round 2 opener splash — fires in sync with the projector */}
        {playerRoundSplash && (
          <div className="fixed inset-0 z-[90] bg-gray-950/95 flex flex-col items-center justify-center pointer-events-none text-center p-6">
            <p className="text-6xl font-black text-yellow-400 mb-3"
              style={{ animation: 'round-splash-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
              ROUND 2
            </p>
            <p className="text-gray-300 font-semibold"
              style={{ animation: 'slide-up-in 0.4s ease-out 0.3s both' }}>
              Bigger points on the board 🍺
            </p>
          </div>
        )}

        {/* pt-24 clears the score chip (top-4 + ~5rem tall) — at pt-16 a long
            "X is choosing…" line ran underneath it */}
        <div className="pt-24 pb-3 px-4 text-center shrink-0">
          {catRevealIds != null ? (
            // During the intros nobody can pick — don't flash "Your pick!" over
            // a board of disabled glasses
            <p className="text-amber-300 font-black text-lg">🍺 Category reveal — eyes on the big screen!</p>
          ) : isMyTurnNow ? (
            <p className="text-yellow-400 font-black text-xl animate-pulse">
              {selectionClaiming ? 'Locking your pick…' : room?.pending_question_id ? 'Pick locked!' : 'Your pick!'}
            </p>
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
              className="grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${boardCategories.length}, minmax(0, 1fr))` }}
            >
              {boardCategories.map(cat => (
                <TapHeader key={cat.id} categoryName={cat.name}
                  reveal={tapHeaderRevealFor(catRevealIds, cat.id)} />
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
                          <div className="absolute inset-0 rounded flex items-center justify-center font-mono font-black text-amber-950"
                            style={{
                              backfaceVisibility: 'hidden',
                              fontSize: 'clamp(1rem, 4vw, 1.4rem)',
                              background: 'linear-gradient(145deg, #fcd34d 0%, #f59e0b 60%, #c2650a 100%)',
                              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)',
                            }}>
                            ${pv}
                          </div>
                          <div className="absolute inset-0 rounded flex items-center justify-center p-1 text-center"
                            style={{
                              backfaceVisibility: 'hidden',
                              transform: 'rotateY(180deg)',
                              background: 'linear-gradient(180deg, #92400e 0%, #78350f 55%, #451a03 100%)',
                            }}>
                            <p className="font-black uppercase text-amber-50 leading-tight"
                              style={{ fontSize: 'clamp(0.55rem, 2.5vw, 0.75rem)' }}>
                              {cat.name}
                            </p>
                          </div>
                          <div style={{ position: 'absolute', top: 0, left: '100%', width: '4px', height: '100%', background: '#2b1608', transform: 'rotateY(90deg)', transformOrigin: 'left center' }} />
                          <div style={{ position: 'absolute', top: 0, right: '100%', width: '4px', height: '100%', background: '#2b1608', transform: 'rotateY(-90deg)', transformOrigin: 'right center' }} />
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div key={q.id} className="h-20">
                      <BeerGlass
                        pointValue={pv}
                        state={answered ? 'empty' : 'full'}
                        disabled={!isMyTurnNow || selectionClaiming || !!room?.pending_question_id || catRevealIds != null}
                        dimmed={!answered && (!isMyTurnNow || selectionClaiming || !!room?.pending_question_id || catRevealIds != null)}
                        onClick={(e) => isMyTurnNow && !answered && !selectionClaiming && !room?.pending_question_id && catRevealIds == null && handleSelectQuestion(q.id, e.currentTarget)}
                      />
                    </div>
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

        <button onClick={handleLeave} disabled={loading}
          className="shrink-0 py-3 text-sm font-medium text-yellow-400 border border-yellow-500 rounded-lg hover:bg-yellow-500 hover:text-black transition-colors text-center w-full disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? 'Leaving…' : 'Leave Team'}
        </button>
        {error && <p className="shrink-0 text-red-400 text-sm text-center">{error}</p>}

        {/* Preview overlay — pointerdown so eager pre-buzz taps register the same
            way the real buzzer does (and count toward the anti-spam lockout) */}
        {previewInfo && (
          <div
            className="fixed inset-0 z-50 wood-bg text-white flex flex-col items-center justify-center p-6 text-center"
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
            <p className="text-amber-300/80 text-xs uppercase tracking-[0.2em] mb-6">Category</p>
            <p className="font-black text-white leading-tight mb-3"
              style={{ fontSize: 'clamp(1.75rem, 7vw, 3rem)' }}>
              {previewInfo.categoryName}
            </p>
            {previewInfo.pointValue != null && !previewInfo.doubleTapWager && (
              <p className="text-yellow-400 font-mono font-black text-3xl mb-6">
                ${previewInfo.pointValue}
              </p>
            )}
            {previewInfo.answer && (
              <p className="text-white font-semibold leading-snug mb-8 max-w-md"
                style={{ fontSize: 'clamp(1.1rem, 4vw, 1.5rem)' }}>
                {previewInfo.answer}
              </p>
            )}
            <p className="text-amber-100/60 text-sm animate-pulse">Waiting for host…</p>
            {buzzLockedOut ? (
              <p className="text-red-400 text-sm font-bold mt-3">🔒 Too many early taps — you're locked out of this one</p>
            ) : preBuzzTaps > 0 ? (
              <p className="text-amber-400 text-xs font-semibold mt-3">Easy — tapping before the buzzer opens will lock you out</p>
            ) : null}
            <QuipCycler />
            {/* Anti-spam catcher. Only taps landing where the buzz button WILL be
                count toward the lockout: pre-loading a tap means parking a thumb on
                the button's spot, whereas a tap up on the clue text is someone
                reading. On the buzz screen the answer card and buzz-window bar take
                the top of the viewport and the button fills the centered flex-1
                below, so that band is roughly the bottom 60%. Transparent, and
                clear of the score chip (top-4 right-4). */}
            <div
              aria-hidden
              onPointerDown={handlePreBuzzTap}
              className="absolute inset-x-0 bottom-0"
              style={{ height: '60%' }}
            />
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
      <div className="relative min-h-screen bar-bg text-white flex flex-col p-6 overflow-hidden" style={answerScreenStyle}>
        {scoreOverlayEl}
        {/* No score chip while answering: it sat on top of the countdown, and the
            clock matters more than "all scores" during a 15-second typing window */}
        <div className="max-w-sm mx-auto w-full flex flex-col flex-1 min-h-0 pt-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-yellow-400 font-black text-xl">Your turn!</p>
            <span className={`inline-block font-mono text-4xl font-black tabular-nums ${dtTimerLow ? 'text-red-400' : 'text-white'}`}
              style={dtTimerLow ? { animation: 'timer-pulse 0.8s ease-in-out infinite' } : undefined}>
              {dtTimer}
            </span>
          </div>

          <div className="w-full h-2 bg-white/10 rounded-full mb-6 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${dtTimerLow ? 'bg-red-500' : 'bg-yellow-400'}`}
              style={{ width: `${dtTimerPct}%` }}
            />
          </div>

          <div className="glass-card rounded-2xl p-4 mb-4 min-h-0 overflow-y-auto">
            <p className="text-xs text-amber-400/70 uppercase tracking-[0.2em] mb-2">The answer</p>
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
                onKeyDown={dismissKeyboardOnEnter}
                enterKeyHint="done"
                rows={2}
                className="w-full shrink-0 bg-white/5 border border-white/10 text-white rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-gray-600 resize-none text-lg mb-4"
              />
              <button
                onClick={handleSubmitResponse}
                disabled={!responseText.trim()}
                className="btn-beer w-full shrink-0 py-4 rounded-2xl font-black text-lg"
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
      <div className="relative min-h-screen bar-bg text-white flex flex-col p-6 overflow-hidden" style={answerScreenStyle}>
        {scoreOverlayEl}
        {/* No score chip while answering: it sat on top of the countdown, and the
            clock matters more than "all scores" during a 15-second typing window */}
        <div className="max-w-sm mx-auto w-full flex flex-col flex-1 min-h-0 pt-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-yellow-400 font-black text-xl">{buzzWasMine ? "You're in! Type fast!" : 'Teammate buzzed! Type fast!'}</p>
            <span className={`inline-block font-mono text-4xl font-black tabular-nums ${ansTimerLow ? 'text-red-400' : 'text-white'}`}
              style={ansTimerLow ? { animation: 'timer-pulse 0.8s ease-in-out infinite' } : undefined}>
              {ansTimer}
            </span>
          </div>

          <div className="w-full h-2 bg-white/10 rounded-full mb-4 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${ansTimerLow ? 'bg-red-500' : 'bg-yellow-400'}`}
              style={{ width: `${ansTimerPct}%` }}
            />
          </div>

          <div className="glass-card rounded-2xl p-4 mb-4 min-h-0 overflow-y-auto">
            <p className="text-xs text-amber-400/70 uppercase tracking-[0.2em] mb-2">The answer</p>
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
                onKeyDown={dismissKeyboardOnEnter}
                enterKeyHint="done"
                rows={2}
                className="w-full shrink-0 bg-white/5 border border-white/10 text-white rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-gray-600 resize-none text-lg mb-4"
              />
              <button
                onClick={handleSubmitResponse}
                disabled={!responseText.trim()}
                className="btn-beer w-full shrink-0 py-4 rounded-2xl font-black text-lg"
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
      <div className="relative min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6 text-center">
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
          <div className="glass-card rounded-2xl px-6 py-4 max-w-xs">
            <p className="text-gray-300 italic">"{responseText}"</p>
          </div>
        ) : (
          <div className="glass-card rounded-2xl px-6 py-4 max-w-xs">
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
      <div className="relative min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <div className="w-3 h-3 rounded-full bg-yellow-400 mb-6 animate-pulse" />
        <p className="text-2xl font-black text-white mb-2">
          {responseSubmitted ? 'Response submitted' : buzzWasMine ? 'Buzzed in!' : 'Your teammate already buzzed'}
        </p>
        <p className="text-gray-500 text-sm">Waiting for the host…</p>
        {responseText && (
          <div className="glass-card rounded-2xl px-6 py-4 max-w-xs mt-6">
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
      <div className="relative min-h-screen bar-bg text-white flex flex-col items-center justify-center p-6 text-center">
        {scoreOverlayEl}
        {scoreChip}
        <div className="text-5xl mb-6">🍺</div>
        <p className="text-2xl font-black text-amber-400 mb-2">Double Tap!</p>
        <p className="text-gray-400 text-lg mb-6">{dtTeamName} is answering</p>
        <div className="glass-card rounded-2xl p-5 max-w-sm w-full">
          <p className="text-xs text-amber-400/70 uppercase tracking-[0.2em] mb-2">The answer</p>
          <p className="text-xl font-bold leading-snug">{activeQuestion.answer}</p>
        </div>
      </div>
    )
  }

  // Active question — buzz phase (question visible, waiting for buzz)
  const buzzWindowClosed = buzzWindowRemaining === 0
  const buzzTimerLow = (buzzWindowRemaining ?? 25) <= 10
  const buzzWindowPct = ((buzzWindowRemaining ?? 25) / 25) * 100

  return (
    // Locked to exactly the viewport: no scroll, no rubber-band, no chance for iOS
    // to read a drifting tap as a slide and swallow the buzz.
    <div className="relative bar-bg text-white flex flex-col p-5 overflow-hidden select-none"
      style={{ height: '100dvh', touchAction: 'manipulation', overscrollBehavior: 'none' }}>
      {scoreOverlayEl}
      {scoreChip}
      <div className="max-w-sm mx-auto w-full flex-1 min-h-0 flex flex-col">
        <div className="glass-card rounded-2xl p-5 mb-4 pt-14">
          <p className="text-xs text-amber-400/70 uppercase tracking-[0.2em] mb-2">The answer</p>
          <p className="text-2xl font-bold leading-snug">{activeQuestion.answer}</p>
          {activeQuestion.point_value && (
            <p className="text-yellow-400 font-mono text-sm mt-3 font-semibold">{activeQuestion.point_value} pts</p>
          )}
        </div>

        {/* Buzz window countdown bar */}
        {buzzWindowRemaining !== null && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Buzz window</p>
              <span className={`inline-block font-mono font-black text-lg tabular-nums ${buzzTimerLow ? 'text-red-400' : 'text-white'}`}
                style={buzzTimerLow ? { animation: 'timer-pulse 0.8s ease-in-out infinite' } : undefined}>
                {buzzWindowRemaining}s
              </span>
            </div>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${buzzTimerLow ? 'bg-red-500' : 'bg-yellow-400'}`}
                style={{ width: `${buzzWindowPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Centered in the remaining space — the bar is the star of this screen */}
        <div className="flex-1 min-h-0 flex flex-col justify-center pb-4">
          {buzzFailed && !buzzLockedOut && !buzzWindowClosed && (
            <p role="alert" className="text-red-400 text-center font-black text-sm mb-3"
              style={{ animation: 'shake-x 0.5s ease-out' }}>
              ⚠️ Buzz didn't go through — tap again!
            </p>
          )}
          {buzzLockedOut ? (
            <div className="w-full py-8 rounded-2xl font-black text-xl bg-white/5 border border-white/10 text-red-400/80 text-center leading-snug">
              🔒 Locked out
              <span className="block text-sm font-medium text-gray-500 mt-1">You tapped too early — wait for another team to answer</span>
            </div>
          ) : buzzWindowClosed ? (
            <div className="w-full py-8 rounded-2xl font-black text-xl bg-white/5 border border-white/10 text-gray-500 text-center">
              Buzz window closed
            </div>
          ) : (
            <div className="flex flex-col items-center transition-transform active:translate-y-[3px] active:scale-[0.98]">
              {/* Tap handle — same brass knob + steel neck as the board's tap wall,
                  so pulling the tap IS the buzz. Decorative; the button below is the target. */}
              <div
                aria-hidden
                className="w-10 h-10 rounded-full z-10 mb-[-4px]"
                style={{
                  background: 'radial-gradient(circle at 35% 30%, #f5e6c8, #b8863b 55%, #6b4a1f 100%)',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.55), inset 0 -2px 4px rgba(0,0,0,0.25)',
                }}
              />
              <div
                aria-hidden
                className="w-3.5 h-6 rounded-sm"
                style={{
                  background: 'linear-gradient(180deg, #a3a3a3 0%, #525252 100%)',
                  boxShadow: 'inset 0 0 2px rgba(255,255,255,0.35)',
                }}
              />
              <div className="relative w-full">
                {/* Glow lives on its own layer animating opacity (composited) — the old
                    box-shadow keyframe animation repainted the big button every frame,
                    a suspect in the iOS "bar hangs" reports */}
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-3xl pointer-events-none"
                  style={{
                    boxShadow: '0 0 55px 10px rgba(220, 38, 38, 0.7)',
                    animation: 'glow-pulse 1.6s ease-in-out infinite',
                  }}
                />
                <button
                  onPointerDown={handleBuzzPointerDown}
                  onClick={handleBuzzClick}
                  disabled={buzzing}
                  className="relative overflow-hidden w-full rounded-3xl font-black text-5xl tracking-wide text-white disabled:opacity-60 select-none"
                  style={{
                    minHeight: 'clamp(150px, 26vh, 250px)',
                    touchAction: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    WebkitUserSelect: 'none',
                    background: 'linear-gradient(180deg, #f87171 0%, #dc2626 45%, #991b1b 100%)',
                    boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.25), inset 0 -4px 8px rgba(0,0,0,0.35)',
                    textShadow: '0 2px 4px rgba(0,0,0,0.4)',
                  }}
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
                  {buzzing ? '…' : 'TAP IN!'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
