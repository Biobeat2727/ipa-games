import { useMemo, useState } from 'react'
import TapCategoryColumn from '../../components/TapCategoryColumn'
import ScoreHistoryChart, { type ScoreSnapshot } from '../../components/ScoreHistoryChart'

const CATEGORIES = ['Beer History', 'Local Breweries', 'Hops & Barley', 'Bar Trivia']
const POINT_VALUES = [100, 200, 300, 400, 500]

// ── Bump-chart sandbox data ───────────────────────────────────
const FAKE_TEAMS = [
  'Barley Legal', 'The Hop Scholars', 'Quizzed on the Rocks', 'Pint Sized Brains',
  'Ale Mary', 'Stout Hearted', 'The Lagerheads', 'Wheat a Minute',
  'Hoptimists', 'Last Call Legends',
]

function makeFakeHistory(teamIds: string[], steps: number): ScoreSnapshot[] {
  // Deterministic LCG so the sandbox story is stable across reloads
  let seed = 42
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const running = new Map(teamIds.map(id => [id, 0]))
  return Array.from({ length: steps }, (_, i) => {
    // Each step: one team gains, sometimes another loses (mimics a judged question)
    const winner = teamIds[Math.floor(rnd() * teamIds.length)]
    const value  = POINT_VALUES[Math.floor(rnd() * POINT_VALUES.length)]
    running.set(winner, (running.get(winner) ?? 0) + value)
    if (rnd() < 0.45) {
      const loser = teamIds[Math.floor(rnd() * teamIds.length)]
      if (loser !== winner) running.set(loser, (running.get(loser) ?? 0) - value)
    }
    return {
      label: `#${i + 1}`,
      scores: teamIds.map(id => ({ team_id: id, score: running.get(id) ?? 0 })),
    }
  })
}

export default function TapPreview() {
  const [teamCount, setTeamCount] = useState(10)
  const teamIds   = useMemo(() => FAKE_TEAMS.slice(0, teamCount).map((_, i) => `team-${i}`), [teamCount])
  const teamNames = useMemo(() => new Map(teamIds.map((id, i) => [id, FAKE_TEAMS[i]])), [teamIds])
  const snapshots = useMemo(() => makeFakeHistory(teamIds, 14), [teamIds])
  // Re-mounting on teamCount change restarts the draw animation
  return (
    <div className="min-h-screen bg-gray-950 text-white p-3">
      <p className="text-center text-gray-500 text-sm mb-4">Click any full glass to test the drain animation</p>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${CATEGORIES.length}, minmax(0, 1fr))`, height: '80vh' }}>
        {CATEGORIES.map(cat => (
          <TapCategoryColumn key={cat} categoryName={cat} pointValues={POINT_VALUES} />
        ))}
      </div>

      {/* ── Intermission bump chart sandbox ── */}
      <div className="mt-10 pb-10">
        <div className="flex items-center justify-center gap-3 mb-4">
          <p className="text-gray-500 text-sm">Bump chart sandbox — teams:</p>
          {[2, 4, 6, 10].map(n => (
            <button key={n} onClick={() => setTeamCount(n)}
              className={`px-3 py-1 rounded-lg text-sm font-bold ${n === teamCount ? 'bg-yellow-400 text-gray-950' : 'bg-gray-800 text-gray-300'}`}>
              {n}
            </button>
          ))}
        </div>
        <div key={teamCount} style={{ height: '70vh' }} className="max-w-5xl mx-auto">
          <ScoreHistoryChart
            snapshots={snapshots}
            teamNames={teamNames}
            teamIds={teamIds}
            highlightTeamId="team-1"
          />
        </div>
      </div>
    </div>
  )
}
