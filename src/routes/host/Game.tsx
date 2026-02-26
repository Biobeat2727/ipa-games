import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { clearHostSession } from '../../lib/session'
import type { Buzz, Question, Room, Team } from '../../lib/types'

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

    // Update host categories immediately so the question is struck from the list
    setCategories(prev => prev.map(cat => ({
      ...cat,
      questions: cat.questions.map(q =>
        q.id === activeQuestion.id ? { ...q, is_answered: true } : q
      ),
    })))

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

    // Update host categories immediately — don't wait for postgres_changes
    if (questionDone) {
      setCategories(prev => prev.map(cat => ({
        ...cat,
        questions: cat.questions.map(q =>
          q.id === activeQuestion.id ? { ...q, is_answered: true } : q
        ),
      })))
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

  const sortedTeams = [...teams].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
  const round1Cats  = categories.filter(c => c.round === 1)
  const round2Cats  = categories.filter(c => c.round === 2)

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
            <button
              onClick={() => { clearHostSession(); window.location.reload() }}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors"
            >
              New Game
            </button>
          </div>
          <div className="space-y-1">
            {sortedTeams.map((team, i) => (
              <div key={team.id} className="flex items-center gap-2">
                <span className="text-xs text-gray-700 w-4 text-right shrink-0">{i + 1}</span>
                <span className={`text-sm flex-1 truncate ${team.id === currentTurnTeamId ? 'text-yellow-400 font-bold' : 'text-gray-300'}`}>
                  {team.name}
                </span>
                <span className={`font-mono text-sm font-bold tabular-nums ${
                  (scores.get(team.id) ?? 0) < 0 ? 'text-red-400' : 'text-yellow-400'
                }`}>
                  {scores.get(team.id) ?? 0}
                </span>
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
                              isActive
                                ? 'bg-yellow-400 text-gray-950 font-bold cursor-default'
                                : isAnswered
                                  ? 'bg-gray-900/50 text-gray-700 line-through cursor-default'
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

      {/* ── Right: active question + judging ─────────────── */}
      <div className="w-7/12 p-5 flex flex-col gap-4 overflow-y-auto">
        {!activeQuestion ? (
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
