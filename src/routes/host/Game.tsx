import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { clearHostSession } from '../../lib/session'
import type { Buzz, Question, Room, Team, Wager } from '../../lib/types'

const RESPONSE_SECONDS = 30

type CategoryRow = {
  id: string
  name: string
  round: number
  questions: Question[]
}

interface Props {
  roomId: string
  initialRoom: Room
  teams: Team[]
}

export default function Game({ roomId, initialRoom, teams }: Props) {
  const [room, setRoom]             = useState<Room>(initialRoom)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [buzzes, setBuzzes]         = useState<Buzz[]>([])
  const [scores, setScores]         = useState<Map<string, number>>(
    new Map(teams.map(t => [t.id, t.score]))
  )
  const [judgingBuzzId, setJudgingBuzzId]     = useState<string | null>(null)
  const [judgeStartTime, setJudgeStartTime]   = useState<number | null>(null)
  const [timerSeconds, setTimerSeconds]       = useState(RESPONSE_SECONDS)
  const [currentTurnTeamId, setCurrentTurnTeamId] = useState<string | null>(null)
  const [previewInfo, setPreviewInfo] = useState<{
    questionId: string; categoryName: string; pointValue: number | null; startTs: number
  } | null>(null)

  const broadcastRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Final Jeopardy state ──────────────────────────────────
  const [fjPhase, setFjPhase]               = useState<'wager' | 'question' | 'review' | 'done' | null>(null)
  const [fjCategoryName, setFjCategoryName] = useState('')
  const [fjQuestion, setFjQuestion]         = useState<Question | null>(null)
  const [fjActiveTeamIds, setFjActiveTeamIds] = useState<Set<string>>(new Set())
  const [fjWagerStatus, setFjWagerStatus]   = useState<Map<string, boolean>>(new Map())
  const [fjWagers, setFjWagers]             = useState<Wager[]>([])
  const [fjRevealOrder, setFjRevealOrder]   = useState<string[]>([])
  const [fjReviewIdx, setFjReviewIdx]       = useState(0)
  const [fjTimerStart, setFjTimerStart]     = useState<number | null>(null)
  const [fjTimerSeconds, setFjTimerSeconds] = useState(90)
  const [fjTimerExpired, setFjTimerExpired] = useState(false)
  const fjActiveTeamIdsRef = useRef<Set<string>>(new Set())

  // Score adjustment
  const [editingScoreTeamId, setEditingScoreTeamId] = useState<string | null>(null)
  const [editingScoreValue, setEditingScoreValue]   = useState('')

  // ── Setup ────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { data: cats } = await supabase
        .from('categories').select('id, name, round')
        .eq('room_id', roomId).order('round').order('name')
      if (!cats) return

      const { data: questions } = await supabase
        .from('questions').select().in('category_id', cats.map(c => c.id))

      setCategories(cats.map(cat => ({
        ...cat,
        questions: (questions ?? [])
          .filter(q => q.category_id === cat.id)
          .sort((a, b) => (a.point_value ?? 0) - (b.point_value ?? 0)),
      })))
    }
    load()
  }, [roomId])

  // Broadcast channel
  useEffect(() => {
    let autoAssigned = false
    const ch = supabase.channel(`room:${initialRoom.code}`)
      .on('broadcast', { event: 'question_preview' }, ({ payload }) => {
        const p = payload as { questionId: string; categoryName: string; pointValue: number | null; startTs: number }
        setPreviewInfo(p)
      })
      .on('broadcast', { event: 'question_activated' }, ({ payload }) => {
        const { question_id } = payload as { question_id: string }
        setPreviewInfo(null)
        setRoom(prev => ({ ...prev, current_question_id: question_id }))
      })
      .on('broadcast', { event: 'fj_wager_locked' }, ({ payload }) => {
        const { team_id } = payload as { team_id: string }
        setFjWagerStatus(prev => new Map([...prev, [team_id, true]]))
      })
    ch.subscribe((status) => {
      // Auto-assign first turn when the game starts
      if (status === 'SUBSCRIBED' && !autoAssigned && teams.length > 0) {
        autoAssigned = true
        const firstTeamId = teams[0].id
        setCurrentTurnTeamId(firstTeamId)
        ch.send({ type: 'broadcast', event: 'turn_change', payload: { team_id: firstTeamId } })
      }
    })
    broadcastRef.current = ch
    return () => { supabase.removeChannel(ch); broadcastRef.current = null }
  }, [initialRoom.code]) // eslint-disable-line react-hooks/exhaustive-deps

  // Host-side fallback: activate question after the 10-second preview countdown.
  // This fires if the player's DB update or broadcast was missed by the host.
  // activateQuestion is idempotent — double-writing the same question_id is harmless.
  useEffect(() => {
    if (!previewInfo) return
    const delay = Math.max(0, previewInfo.startTs + 10_000 - Date.now())
    const id = setTimeout(() => activateQuestion(previewInfo.questionId), delay)
    return () => clearTimeout(id)
  }, [previewInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to room + question + team score changes
  useEffect(() => {
    const ch = supabase.channel(`host-game-${roomId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        payload => setRoom(payload.new as Room))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'questions' },
        payload => {
          const q = payload.new as Question
          setCategories(prev => prev.map(cat => ({
            ...cat,
            questions: cat.questions.map(old => old.id === q.id ? q : old),
          })))
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'teams', filter: `room_id=eq.${roomId}` },
        payload => {
          const t = payload.new as Team
          setScores(prev => new Map([...prev, [t.id, t.score]]))
        })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          // Re-fetch scores from DB in case any team updates were missed during connection
          const { data } = await supabase.from('teams').select('id, score').eq('room_id', roomId)
          if (data) setScores(new Map(data.map(t => [t.id, t.score])))
        }
      })
    return () => { supabase.removeChannel(ch) }
  }, [roomId])

  // Subscribe to buzzes for the active question
  const fetchBuzzes = useCallback(async (questionId: string) => {
    const { data } = await supabase
      .from('buzzes').select().eq('question_id', questionId).order('buzzed_at', { ascending: true })
    setBuzzes(data ?? [])
  }, [])

  useEffect(() => {
    const qId = room.current_question_id
    if (!qId) {
      setBuzzes([])
      setJudgingBuzzId(null)
      setJudgeStartTime(null)
      return
    }
    fetchBuzzes(qId)
    const ch = supabase.channel(`host-buzzes-${qId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'buzzes', filter: `question_id=eq.${qId}` },
        () => fetchBuzzes(qId))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [room.current_question_id, fetchBuzzes])

  // FJ wager subscription — keep fjWagers in sync through review so late auto-submits arrive
  useEffect(() => {
    if (!fjPhase || fjPhase === 'done') return
    const fetchWagers = async () => {
      const { data } = await supabase.from('wagers').select().eq('room_id', roomId)
      setFjWagers(data ?? [])
    }
    const ch = supabase.channel(`host-fj-wagers-${roomId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'wagers', filter: `room_id=eq.${roomId}` },
        fetchWagers)
      .subscribe(async () => { await fetchWagers() })
    return () => { supabase.removeChannel(ch) }
  }, [fjPhase, roomId])

  // Keep fjActiveTeamIdsRef in sync so the timer expiry effect always has fresh values
  useEffect(() => { fjActiveTeamIdsRef.current = fjActiveTeamIds }, [fjActiveTeamIds])

  // FJ 90-second answer timer
  useEffect(() => {
    if (fjPhase !== 'question' || fjTimerStart === null) return
    const tick = () => {
      const elapsed = Math.floor((Date.now() - fjTimerStart) / 1000)
      const remaining = Math.max(0, 90 - elapsed)
      setFjTimerSeconds(remaining)
      if (remaining === 0) setFjTimerExpired(true)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [fjPhase, fjTimerStart])

  // FJ timer expiry → broadcast, wait for player auto-submits, fresh fetch, build reveal order
  useEffect(() => {
    if (!fjTimerExpired || fjPhase !== 'question') return
    setFjTimerExpired(false)
    broadcastRef.current?.send({ type: 'broadcast', event: 'fj_timer_expired', payload: {} })

    // Capture synchronously before any awaits
    const activeIds    = fjActiveTeamIdsRef.current
    const currentTeams = teams
    const currentScores = scores

    ;(async () => {
      // Give players time to receive the broadcast and auto-submit their responses
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Fresh fetch — don't rely on potentially stale fjWagers state
      const { data } = await supabase.from('wagers').select().eq('room_id', roomId)
      const latestWagers = data ?? []
      setFjWagers(latestWagers)

      const order = currentTeams
        .filter(t => activeIds.has(t.id))
        .sort((a, b) => (currentScores.get(a.id) ?? 0) - (currentScores.get(b.id) ?? 0))
        .map(t => t.id)
      setFjRevealOrder(order)
      setFjReviewIdx(0)
      setFjPhase('review')

      if (order.length > 0) {
        const wager = latestWagers.find(w => w.team_id === order[0])
        broadcastRef.current?.send({
          type: 'broadcast',
          event: 'fj_answer_reveal',
          payload: { team_id: order[0], team_name: teamName(order[0]), response: wager?.response ?? null },
        })
      }
    })()
  }, [fjTimerExpired]) // eslint-disable-line react-hooks/exhaustive-deps

  // Judge timer countdown
  useEffect(() => {
    if (judgeStartTime === null) { setTimerSeconds(RESPONSE_SECONDS); return }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - judgeStartTime) / 1000)
      setTimerSeconds(Math.max(0, RESPONSE_SECONDS - elapsed))
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [judgeStartTime])

  // ── Actions ───────────────────────────────────────────────

  async function activateQuestion(questionId: string) {
    const { error } = await supabase
      .from('rooms').update({ current_question_id: questionId }).eq('id', roomId)
    if (!error) {
      setRoom(prev => ({ ...prev, current_question_id: questionId }))
      setPreviewInfo(null)
      broadcastRef.current?.send({
        type: 'broadcast',
        event: 'question_activated',
        payload: { question_id: questionId },
      })
    } else console.error('activateQuestion failed:', error)
  }

  async function deactivateQuestion() {
    const { error } = await supabase
      .from('rooms').update({ current_question_id: null }).eq('id', roomId)
    if (!error) {
      setRoom(prev => ({ ...prev, current_question_id: null }))
      broadcastRef.current?.send({
        type: 'broadcast',
        event: 'question_deactivated',
        payload: {},
      })
    } else console.error('deactivateQuestion failed:', error)
  }

  function handleJudge(buzz: Buzz) {
    const startTs = Date.now()
    setJudgingBuzzId(buzz.id)
    setJudgeStartTime(startTs)
    broadcastRef.current?.send({
      type: 'broadcast',
      event: 'timer_start',
      payload: {
        start_timestamp: startTs,
        duration_seconds: RESPONSE_SECONDS,
        team_id: buzz.team_id,
        buzz_id: buzz.id,
        team_name: teamName(buzz.team_id),
      },
    })
  }

  function clearJudging() {
    setJudgingBuzzId(null)
    setJudgeStartTime(null)
  }

  function assignTurn(teamId: string | null) {
    setCurrentTurnTeamId(teamId)
    broadcastRef.current?.send({
      type: 'broadcast',
      event: 'turn_change',
      payload: { team_id: teamId },
    })
  }

  async function handleCorrect(buzz: Buzz) {
    if (!activeQuestion) return
    const pointValue   = activeQuestion.point_value ?? 0
    const currentScore = scores.get(buzz.team_id) ?? 0
    const newScore     = currentScore + pointValue

    await Promise.all([
      supabase.from('buzzes').update({ status: 'correct' }).eq('id', buzz.id),
      supabase.from('teams').update({ score: newScore }).eq('id', buzz.team_id),
      supabase.from('questions')
        .update({ is_answered: true, answered_by_team_id: buzz.team_id })
        .eq('id', activeQuestion.id),
    ])

    const updatedScores = new Map([...scores, [buzz.team_id, newScore]])
    setScores(updatedScores)

    // Compute updated categories inline so we can check round completion immediately
    const nextCategories = categories.map(cat => ({
      ...cat,
      questions: cat.questions.map(q =>
        q.id === activeQuestion.id ? { ...q, is_answered: true } : q
      ),
    }))
    setCategories(nextCategories)

    broadcastRef.current?.send({
      type: 'broadcast',
      event: 'score_update',
      payload: {
        teams: teams.map(t => ({ id: t.id, name: t.name, score: updatedScores.get(t.id) ?? t.score })),
        current_question_id: null,
        answered_question_id: activeQuestion.id,
      },
    })

    clearJudging()
    assignTurn(buzz.team_id)
    deactivateQuestion()
  }

  async function handleWrong(buzz: Buzz) {
    if (!activeQuestion) return
    const pointValue   = activeQuestion.point_value ?? 0
    const currentScore = scores.get(buzz.team_id) ?? 0
    const newScore     = currentScore - pointValue

    // Compute using local state before the DB writes — local buzz state is current
    const remainingPending = buzzes.filter(b => b.status === 'pending' && b.id !== buzz.id)
    const questionDone     = remainingPending.length === 0

    await Promise.all([
      supabase.from('buzzes').update({ status: 'wrong' }).eq('id', buzz.id),
      supabase.from('teams').update({ score: newScore }).eq('id', buzz.team_id),
    ])
    // When all buzzes are exhausted mark the question answered so every board greys it out
    if (questionDone) {
      await supabase.from('questions').update({ is_answered: true }).eq('id', activeQuestion.id)
    }

    const updatedScores = new Map([...scores, [buzz.team_id, newScore]])
    setScores(updatedScores)
    setBuzzes(prev => prev.map(b => b.id === buzz.id ? { ...b, status: 'wrong' } : b))

    // Compute updated categories inline so we can check round completion when questionDone
    let nextCategories = categories
    if (questionDone) {
      nextCategories = categories.map(cat => ({
        ...cat,
        questions: cat.questions.map(q =>
          q.id === activeQuestion.id ? { ...q, is_answered: true } : q
        ),
      }))
      setCategories(nextCategories)
    }

    broadcastRef.current?.send({
      type: 'broadcast',
      event: 'score_update',
      payload: {
        teams: teams.map(t => ({ id: t.id, name: t.name, score: updatedScores.get(t.id) ?? t.score })),
        ...(questionDone ? { current_question_id: null, answered_question_id: activeQuestion.id } : {}),
      },
    })

    clearJudging()

    if (questionDone) {
      assignTurn(null)
      deactivateQuestion()
    }
  }

  // ── Final Jeopardy actions ────────────────────────────────

  async function startFinalJeopardy() {
    // Rank teams by current live score; top 3 advance
    const ranked = [...teams].sort((a, b) => (scores.get(b.id) ?? b.score) - (scores.get(a.id) ?? a.score))
    const top3ids = new Set(ranked.slice(0, 3).map(t => t.id))
    const eliminated = ranked.slice(3)

    // Load FJ category + question before touching DB
    const { data: fjCat } = await supabase
      .from('categories').select().eq('room_id', roomId).eq('round', 3).single()
    const catName = fjCat?.name ?? 'Final Jeopardy'
    let loadedQuestion: Question | null = null
    if (fjCat) {
      const { data: q } = await supabase.from('questions').select().eq('category_id', fjCat.id).single()
      loadedQuestion = q ?? null
    }

    if (eliminated.length > 0) {
      await Promise.all(eliminated.map(t =>
        supabase.from('teams').update({ is_active: false }).eq('id', t.id)
      ))
    }
    await supabase.from('rooms').update({ status: 'final_jeopardy' }).eq('id', roomId)

    setRoom(prev => ({ ...prev, status: 'final_jeopardy' }))
    setFjActiveTeamIds(top3ids)
    setFjCategoryName(catName)
    setFjQuestion(loadedQuestion)
    setFjPhase('wager')
    broadcastRef.current?.send({
      type: 'broadcast',
      event: 'game_state_change',
      payload: { status: 'final_jeopardy', fj_category: catName, active_team_ids: [...top3ids] },
    })
  }

  async function revealFJQuestion() {
    if (!fjQuestion) return
    const startTs = Date.now()
    setFjPhase('question')
    setFjTimerStart(startTs)
    broadcastRef.current?.send({
      type: 'broadcast',
      event: 'fj_question_revealed',
      payload: { question_id: fjQuestion.id, start_ts: startTs, duration: 90 },
    })
  }

  async function handleFJCorrect(wager: Wager) {
    const revealOrder  = fjRevealOrder
    const wagerList    = fjWagers
    const reviewIdx    = fjReviewIdx
    const currentScore = scores.get(wager.team_id) ?? 0
    const newScore     = currentScore + wager.amount

    await Promise.all([
      supabase.from('wagers').update({ status: 'correct' }).eq('id', wager.id),
      supabase.from('teams').update({ score: newScore }).eq('id', wager.team_id),
    ])
    const updatedScores = new Map([...scores, [wager.team_id, newScore]])
    setScores(updatedScores)
    broadcastRef.current?.send({
      type: 'broadcast', event: 'fj_answer_judged',
      payload: { team_id: wager.team_id, status: 'correct', wager: wager.amount, new_score: newScore },
    })

    const nextIdx = reviewIdx + 1
    if (nextIdx >= revealOrder.length) {
      finishGame(updatedScores)
    } else {
      setFjReviewIdx(nextIdx)
      const nextId = revealOrder[nextIdx]
      const nextWager = wagerList.find(w => w.team_id === nextId)
      broadcastRef.current?.send({
        type: 'broadcast', event: 'fj_answer_reveal',
        payload: { team_id: nextId, team_name: teamName(nextId), response: nextWager?.response ?? null },
      })
    }
  }

  async function handleFJWrong(wager: Wager) {
    const revealOrder  = fjRevealOrder
    const wagerList    = fjWagers
    const reviewIdx    = fjReviewIdx
    const currentScore = scores.get(wager.team_id) ?? 0
    const newScore     = currentScore - wager.amount

    await Promise.all([
      supabase.from('wagers').update({ status: 'wrong' }).eq('id', wager.id),
      supabase.from('teams').update({ score: newScore }).eq('id', wager.team_id),
    ])
    const updatedScores = new Map([...scores, [wager.team_id, newScore]])
    setScores(updatedScores)
    broadcastRef.current?.send({
      type: 'broadcast', event: 'fj_answer_judged',
      payload: { team_id: wager.team_id, status: 'wrong', wager: wager.amount, new_score: newScore },
    })

    const nextIdx = reviewIdx + 1
    if (nextIdx >= revealOrder.length) {
      finishGame(updatedScores)
    } else {
      setFjReviewIdx(nextIdx)
      const nextId = revealOrder[nextIdx]
      const nextWager = wagerList.find(w => w.team_id === nextId)
      broadcastRef.current?.send({
        type: 'broadcast', event: 'fj_answer_reveal',
        payload: { team_id: nextId, team_name: teamName(nextId), response: nextWager?.response ?? null },
      })
    }
  }

  async function finishGame(finalScores: Map<string, number>) {
    await supabase.from('rooms').update({ status: 'finished', current_question_id: null }).eq('id', roomId)
    setRoom(prev => ({ ...prev, status: 'finished', current_question_id: null }))
    setFjPhase('done')
    broadcastRef.current?.send({
      type: 'broadcast', event: 'game_over',
      payload: { scores: teams.map(t => ({ id: t.id, name: t.name, score: finalScores.get(t.id) ?? t.score })) },
    })
  }

  async function commitScoreEdit(teamId: string) {
    const parsed = parseInt(editingScoreValue)
    setEditingScoreTeamId(null)
    if (isNaN(parsed)) return
    await supabase.from('teams').update({ score: parsed }).eq('id', teamId)
    const updatedScores = new Map([...scores, [teamId, parsed]])
    setScores(updatedScores)
    broadcastRef.current?.send({
      type: 'broadcast', event: 'score_update',
      payload: { teams: teams.map(t => ({ id: t.id, name: t.name, score: updatedScores.get(t.id) ?? t.score })) },
    })
  }

  async function transitionToRound2() {
    // Capture turn assignment before the async gap so it doesn't go stale
    const firstTeamId = currentTurnTeamId
    const { error } = await supabase
      .from('rooms').update({ status: 'round_2' }).eq('id', roomId)
    if (!error) {
      setRoom(prev => ({ ...prev, status: 'round_2' }))
      assignTurn(firstTeamId)
      broadcastRef.current?.send({
        type: 'broadcast',
        event: 'game_state_change',
        payload: { status: 'round_2' },
      })
    }
  }

  // ── Derived ───────────────────────────────────────────────

  const activeQuestion = categories.flatMap(c => c.questions)
    .find(q => q.id === room.current_question_id) ?? null

  const judgingBuzz = judgingBuzzId
    ? buzzes.find(b => b.id === judgingBuzzId) ?? null
    : null

  const pendingBuzzes = buzzes.filter(b => b.status === 'pending')

  function teamName(teamId: string) {
    return teams.find(t => t.id === teamId)?.name ?? 'Unknown'
  }

  const sortedTeams    = [...teams].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
  const round1Cats     = categories.filter(c => c.round === 1)
  const round2Cats     = categories.filter(c => c.round === 2)
  const round1Complete = room.status === 'round_1' &&
    round1Cats.length > 0 &&
    round1Cats.every(cat => cat.questions.every(q => q.is_answered))
  const round2Complete = room.status === 'round_2' &&
    round2Cats.length > 0 &&
    round2Cats.every(cat => cat.questions.every(q => q.is_answered))

  const timerLow = timerSeconds <= 10

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="h-screen bg-gray-950 text-white flex overflow-hidden">

      {/* ── Left: scores + question list ─────────────────── */}
      <div className="w-5/12 border-r border-gray-800 flex flex-col overflow-hidden">

        {/* Scores */}
        <div className="shrink-0 bg-gray-900 border-b border-gray-800 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Scoreboard</p>
            <span className="font-mono text-sm font-black text-yellow-400 tracking-widest">{room.code}</span>
            <button
              onClick={() => { clearHostSession(); window.location.reload() }}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors"
            >
              New Game
            </button>
          </div>
          <div className="space-y-1 overflow-y-auto max-h-48">
            {sortedTeams.map((team, i) => (
              <div key={team.id} className="flex items-center gap-2">
                <span className="text-xs text-gray-700 w-4 text-right shrink-0">{i + 1}</span>
                <span className={`text-sm flex-1 truncate ${team.id === currentTurnTeamId ? 'text-yellow-400 font-bold' : 'text-gray-300'}`}>
                  {team.name}
                </span>
                {editingScoreTeamId === team.id ? (
                  <input
                    autoFocus
                    type="number"
                    value={editingScoreValue}
                    onChange={e => setEditingScoreValue(e.target.value)}
                    onBlur={() => commitScoreEdit(team.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitScoreEdit(team.id)
                      if (e.key === 'Escape') setEditingScoreTeamId(null)
                    }}
                    className="w-16 bg-gray-800 text-yellow-400 font-mono text-sm font-bold text-right rounded px-1 outline-none focus:ring-1 focus:ring-yellow-400 tabular-nums"
                  />
                ) : (
                  <button
                    onClick={() => { setEditingScoreTeamId(team.id); setEditingScoreValue(String(scores.get(team.id) ?? 0)) }}
                    className={`font-mono text-sm font-bold tabular-nums hover:underline ${
                      (scores.get(team.id) ?? 0) < 0 ? 'text-red-400' : 'text-yellow-400'
                    }`}
                    title="Click to adjust score"
                  >
                    {scores.get(team.id) ?? 0}
                  </button>
                )}
                <button
                  onClick={() => assignTurn(team.id === currentTurnTeamId ? null : team.id)}
                  className={`text-xs px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                    team.id === currentTurnTeamId
                      ? 'bg-yellow-400 text-gray-950 font-bold'
                      : 'text-gray-600 hover:text-yellow-400'
                  }`}
                >
                  {team.id === currentTurnTeamId ? 'picking' : 'give'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Question list */}
        <div className="flex-1 overflow-y-auto p-4">
          {[{ label: 'Round 1', cats: round1Cats }, { label: 'Round 2', cats: round2Cats }]
            .filter(r => r.cats.length > 0)
            .map(r => (
              <div key={r.label} className="mb-6">
                <p className="text-gray-500 text-xs uppercase tracking-widest mb-3 font-semibold">{r.label}</p>
                {r.cats.map(cat => (
                  <div key={cat.id} className="mb-4">
                    <p className="text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">{cat.name}</p>
                    <div className="space-y-1">
                      {cat.questions.map(q => {
                        const isActive   = q.id === room.current_question_id
                        const isAnswered = q.is_answered
                        return (
                          <button
                            key={q.id}
                            onClick={() => !isAnswered && !isActive && activateQuestion(q.id)}
                            disabled={isAnswered || isActive}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                              isAnswered
                                ? 'bg-gray-900/50 text-gray-700 line-through cursor-default'
                                : isActive
                                  ? 'bg-yellow-400 text-gray-950 font-bold cursor-default'
                                  : 'bg-gray-800 hover:bg-gray-700 text-white'
                            }`}
                          >
                            <span className="font-mono mr-2 opacity-60">{q.point_value}</span>
                            {q.answer.length > 60 ? q.answer.slice(0, 60) + '…' : q.answer}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>

      {/* ── Right: active question / judging / FJ ────────── */}
      <div className="w-7/12 p-5 flex flex-col gap-4 overflow-y-auto">
        {fjPhase ? (

          fjPhase === 'wager' ? (
            <div className="flex-1 flex flex-col gap-4">
              <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                <p className="text-xs text-yellow-400 uppercase tracking-widest font-semibold mb-1">Final Jeopardy</p>
                <p className="text-2xl font-black text-white mb-1">{fjCategoryName}</p>
                <p className="text-gray-500 text-sm">Collecting wagers — reveal the question when all teams are ready</p>
              </div>
              <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 flex-1">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Wager Status</p>
                <div className="space-y-3">
                  {teams.filter(t => fjActiveTeamIds.has(t.id)).map(team => {
                    const wagered = fjWagerStatus.get(team.id) ?? false
                    return (
                      <div key={team.id} className="flex items-center gap-3">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${wagered ? 'bg-green-400' : 'bg-gray-600 animate-pulse'}`} />
                        <span className="flex-1 font-semibold">{team.name}</span>
                        <span className="font-mono text-sm text-yellow-400">{scores.get(team.id) ?? 0}</span>
                        <span className={`text-xs font-semibold ${wagered ? 'text-green-400' : 'text-gray-600'}`}>
                          {wagered ? 'Ready' : 'Waiting…'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <button
                onClick={revealFJQuestion}
                disabled={!fjQuestion}
                className="py-4 rounded-2xl text-xl font-black bg-yellow-400 text-gray-950 hover:bg-yellow-300 disabled:opacity-30 transition-colors"
              >
                {fjWagerStatus.size >= fjActiveTeamIds.size && fjActiveTeamIds.size > 0
                  ? 'Reveal Question →' : 'Reveal Anyway →'}
              </button>
            </div>

          ) : fjPhase === 'question' ? (
            <div className="flex-1 flex flex-col gap-4">
              <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-500 uppercase tracking-widest">Final Jeopardy — Answering</p>
                  <span className={`font-mono text-4xl font-black tabular-nums ${fjTimerSeconds <= 15 ? 'text-red-400' : 'text-yellow-400'}`}>
                    {fjTimerSeconds}
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${fjTimerSeconds <= 15 ? 'bg-red-500' : 'bg-yellow-400'}`}
                    style={{ width: `${(fjTimerSeconds / 90) * 100}%` }}
                  />
                </div>
              </div>
              {fjQuestion && (
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 flex-1">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">The Answer</p>
                  <p className="text-lg font-bold leading-snug mb-4">{fjQuestion.answer}</p>
                  <div className="border-t border-gray-800 pt-3">
                    <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Expected Response</p>
                    <p className="text-green-400 font-semibold">{fjQuestion.correct_question}</p>
                  </div>
                </div>
              )}
              <button
                onClick={() => setFjTimerExpired(true)}
                className="py-3 rounded-xl text-sm font-bold text-gray-500 hover:text-red-400 border border-gray-800 hover:border-red-800 transition-colors"
              >
                End Timer Early
              </button>
            </div>

          ) : fjPhase === 'review' ? (() => {
            const reviewTeamId = fjRevealOrder[fjReviewIdx]
            const reviewWager  = fjWagers.find(w => w.team_id === reviewTeamId)
            if (!reviewTeamId || !reviewWager) return (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-gray-600">Loading review…</p>
              </div>
            )
            return (
              <div className="flex-1 flex flex-col gap-4">
                <div className="bg-gray-900 rounded-xl px-4 py-3 border border-gray-800 flex items-center justify-between">
                  <p className="text-xs text-gray-500 uppercase tracking-widest">
                    Team {fjReviewIdx + 1} of {fjRevealOrder.length}
                  </p>
                  <span className="text-xs text-gray-600 font-mono">wager: {reviewWager.amount}</span>
                </div>
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 flex-1 flex flex-col">
                  <p className="text-2xl font-black mb-1">{teamName(reviewTeamId)}</p>
                  <p className="text-xs text-yellow-400 font-mono mb-4">Wagered {reviewWager.amount} pts</p>
                  <div className="flex-1 bg-gray-800 rounded-xl p-4 min-h-16">
                    {reviewWager.response
                      ? <p className="text-white text-lg">{reviewWager.response}</p>
                      : <p className="text-gray-600 text-sm italic">No response submitted</p>}
                  </div>
                </div>
                {fjQuestion && (
                  <div className="bg-gray-950 rounded-xl px-4 py-2 border border-gray-800">
                    <p className="text-xs text-gray-600 uppercase tracking-wider">Expected</p>
                    <p className="text-green-400 text-sm font-semibold">{fjQuestion.correct_question}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleFJWrong(reviewWager)}
                    className="py-5 rounded-2xl font-black text-xl bg-red-700 hover:bg-red-600 active:bg-red-800 transition-colors"
                  >
                    ✗ Wrong −{reviewWager.amount}
                  </button>
                  <button
                    onClick={() => handleFJCorrect(reviewWager)}
                    className="py-5 rounded-2xl font-black text-xl bg-green-600 hover:bg-green-500 active:bg-green-700 transition-colors"
                  >
                    ✓ Correct +{reviewWager.amount}
                  </button>
                </div>
              </div>
            )
          })() : (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
              <p className="text-xs text-gray-500 uppercase tracking-widest">Game Over</p>
              <p className="text-3xl font-black text-yellow-400">{sortedTeams[0]?.name} wins!</p>
              <div className="w-full space-y-2">
                {sortedTeams.map((team, i) => (
                  <div key={team.id} className="flex items-center gap-3 bg-gray-900 rounded-xl px-4 py-3">
                    <span className="text-gray-600 w-6 text-center font-mono text-sm">{i + 1}</span>
                    <span className="flex-1 font-semibold">{team.name}</span>
                    <span className={`font-mono font-black text-sm ${(scores.get(team.id) ?? 0) < 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                      {scores.get(team.id) ?? 0}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { clearHostSession(); window.location.reload() }}
                className="w-full py-3 rounded-xl text-sm font-bold bg-gray-800 text-white hover:bg-gray-700 transition-colors"
              >
                New Game
              </button>
            </div>
          )

        ) : !activeQuestion ? (
          previewInfo ? (
            // ── Category preview ────────────────────────
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
              <p className="text-xs text-gray-500 uppercase tracking-widest">Category Reveal</p>
              <p className="font-black text-white text-3xl leading-tight">{previewInfo.categoryName}</p>
              {previewInfo.pointValue != null && (
                <p className="text-yellow-400 font-mono text-xl font-bold">${previewInfo.pointValue}</p>
              )}
              <p className="text-gray-600 text-xs mt-2">Players see a 10-second countdown</p>
              <button
                onClick={() => activateQuestion(previewInfo.questionId)}
                className="mt-4 px-6 py-2 rounded-xl text-sm font-bold bg-yellow-400 text-gray-950 hover:bg-yellow-300 transition-colors"
              >
                Activate Now
              </button>
            </div>
          ) : round2Complete ? (
            // ── Start Final Jeopardy ──────────────────────
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
              <div className="text-center">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Round 2 Complete</p>
                <p className="text-2xl font-black text-white">Ready for Final Jeopardy?</p>
                <p className="text-gray-500 text-sm mt-2">Top 3 teams advance</p>
              </div>
              <div className="w-full space-y-2">
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Advancing</p>
                {sortedTeams.slice(0, 3).map(team => (
                  <div key={team.id} className="px-4 py-3 rounded-xl bg-yellow-400/10 border border-yellow-400/30 flex items-center justify-between">
                    <span className="font-bold text-white">{team.name}</span>
                    <span className="font-mono text-yellow-400 text-sm">{scores.get(team.id) ?? 0}</span>
                  </div>
                ))}
                {sortedTeams.length > 3 && (
                  <>
                    <p className="text-xs text-gray-600 uppercase tracking-wider mt-3 mb-1">Eliminated</p>
                    {sortedTeams.slice(3).map(team => (
                      <div key={team.id} className="px-4 py-3 rounded-xl bg-gray-900 flex items-center justify-between opacity-50">
                        <span className="text-gray-400">{team.name}</span>
                        <span className="font-mono text-gray-600 text-sm">{scores.get(team.id) ?? 0}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
              <button
                onClick={startFinalJeopardy}
                className="w-full py-4 rounded-2xl text-xl font-black bg-yellow-400 text-gray-950 hover:bg-yellow-300 transition-colors"
              >
                Start Final Jeopardy →
              </button>
            </div>
          ) : round1Complete ? (
            // ── Start Round 2 ────────────────────────────
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
              <div className="text-center">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Round 1 Complete</p>
                <p className="text-2xl font-black text-white">Ready for Round 2?</p>
                <p className="text-gray-500 text-sm mt-2">Assign first pick, then start when you're ready</p>
              </div>

              <div className="w-full space-y-2">
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">First pick</p>
                {sortedTeams.map(team => (
                  <button
                    key={team.id}
                    onClick={() => setCurrentTurnTeamId(
                      team.id === currentTurnTeamId ? null : team.id
                    )}
                    className={`w-full px-4 py-3 rounded-xl text-sm font-bold transition-colors flex items-center justify-between ${
                      team.id === currentTurnTeamId
                        ? 'bg-yellow-400 text-gray-950'
                        : 'bg-gray-800 hover:bg-gray-700 text-white'
                    }`}
                  >
                    <span>{team.name}</span>
                    <span className="font-mono text-xs opacity-70">
                      {scores.get(team.id) ?? 0}
                    </span>
                  </button>
                ))}
              </div>

              <button
                onClick={transitionToRound2}
                className="w-full py-4 rounded-2xl text-xl font-black bg-yellow-400 text-gray-950 hover:bg-yellow-300 transition-colors"
              >
                Start Round 2 →
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <p className="text-gray-700 text-sm">No active question</p>
              <p className="text-gray-800 text-xs">Select one from the list on the left</p>
            </div>
          )
        ) : (
          <>
            {/* Question card */}
            <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-yellow-400 text-gray-950 font-bold px-2 py-0.5 rounded-full">
                    Active
                  </span>
                  {activeQuestion.point_value && (
                    <span className="text-xs text-yellow-400 font-mono font-semibold">
                      {activeQuestion.point_value} pts
                    </span>
                  )}
                </div>
                <button
                  onClick={deactivateQuestion}
                  className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                >
                  Deactivate
                </button>
              </div>
              <p className="text-lg font-bold mt-3 mb-4 leading-snug">{activeQuestion.answer}</p>
              <div className="border-t border-gray-800 pt-3">
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Expected response</p>
                <p className="text-green-400 font-semibold">{activeQuestion.correct_question}</p>
              </div>
            </div>

            {judgingBuzz ? (
              // ── Judging panel ───────────────────────────
              <div className="bg-gray-900 rounded-2xl p-5 flex-1 flex flex-col border border-gray-800">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Judging</p>
                  <span className={`font-mono text-4xl font-black tabular-nums leading-none ${
                    timerLow ? 'text-red-400' : 'text-yellow-400'
                  }`}>
                    {timerSeconds}
                  </span>
                </div>

                {/* Timer bar */}
                <div className="w-full h-1.5 bg-gray-800 rounded-full mb-4 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${timerLow ? 'bg-red-500' : 'bg-yellow-400'}`}
                    style={{ width: `${(timerSeconds / RESPONSE_SECONDS) * 100}%` }}
                  />
                </div>

                <p className="text-2xl font-black mb-4">{teamName(judgingBuzz.team_id)}</p>

                <div className="flex-1 bg-gray-800 rounded-xl p-4 mb-5 min-h-20">
                  {judgingBuzz.response ? (
                    <p className="text-white text-lg">{judgingBuzz.response}</p>
                  ) : (
                    <p className="text-gray-600 text-sm italic">Waiting for response…</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleWrong(judgingBuzz)}
                    className="py-5 rounded-2xl font-black text-xl bg-red-700 hover:bg-red-600 active:bg-red-800 transition-colors"
                  >
                    ✗ Wrong
                  </button>
                  <button
                    onClick={() => handleCorrect(judgingBuzz)}
                    className="py-5 rounded-2xl font-black text-xl bg-green-600 hover:bg-green-500 active:bg-green-700 transition-colors"
                  >
                    ✓ Correct
                  </button>
                </div>

                <button
                  onClick={clearJudging}
                  className="mt-3 text-xs text-gray-700 hover:text-gray-500 transition-colors"
                >
                  Cancel judging
                </button>
              </div>
            ) : (
              // ── Buzz queue ──────────────────────────────
              <div className="bg-gray-900 rounded-2xl p-5 flex-1 border border-gray-800">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Buzz Queue</h3>
                  <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">
                    {pendingBuzzes.length} pending
                  </span>
                </div>

                {buzzes.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-700 text-sm">Waiting for buzzes…</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {buzzes.map((buzz, i) => {
                      const isNextUp = buzz.id === pendingBuzzes[0]?.id
                      return (
                        <li
                          key={buzz.id}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl ${
                            buzz.status === 'correct'
                              ? 'bg-green-900/30 border border-green-800/60'
                              : buzz.status === 'wrong' || buzz.status === 'expired'
                                ? 'opacity-40 bg-gray-800/50'
                                : isNextUp
                                  ? 'bg-yellow-400/10 border border-yellow-400/50'
                                  : 'bg-gray-800'
                          }`}
                        >
                          <span className="text-xs text-gray-600 w-5 shrink-0 text-center font-mono">{i + 1}</span>
                          <span className={`font-semibold flex-1 ${isNextUp ? 'text-yellow-400' : 'text-white'}`}>
                            {teamName(buzz.team_id)}
                          </span>
                          <span className={`text-xs font-medium ${
                            buzz.status === 'correct' ? 'text-green-400'
                            : buzz.status === 'wrong'   ? 'text-red-400'
                            : buzz.status === 'expired' ? 'text-gray-600'
                            : 'text-gray-500'
                          }`}>
                            {buzz.status}
                          </span>
                          {isNextUp && (
                            <button
                              onClick={() => handleJudge(buzz)}
                              className="ml-1 px-4 py-1.5 rounded-lg text-xs font-black bg-yellow-400 text-gray-950 hover:bg-yellow-300 transition-colors"
                            >
                              Judge
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
