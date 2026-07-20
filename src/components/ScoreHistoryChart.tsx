import { useState } from 'react'
import type { ScoreSnapshot } from '../lib/types'

export type { ScoreSnapshot }

interface Props {
  snapshots: ScoreSnapshot[]
  teamNames: Map<string, string>
  /** All team IDs that should appear — needed so we can add Start (0) for everyone */
  teamIds: string[]
  /** Player view: this team starts selected (bold line + detail bar below) */
  highlightTeamId?: string | null
}

// Distinct colors that pop on dark backgrounds — enough for 12 teams before cycling
const TEAM_COLORS = [
  '#f59e0b', // amber
  '#34d399', // emerald
  '#60a5fa', // blue
  '#f87171', // red
  '#a78bfa', // violet
  '#fb923c', // orange
  '#f472b6', // pink
  '#38bdf8', // sky
  '#a3e635', // lime
  '#2dd4bf', // teal
  '#818cf8', // indigo
  '#fb7185', // rose
]

/** Color assignment is deterministic (team ids sorted lexicographically), so the same
 *  team gets the same line color on every surface regardless of the order the caller
 *  passes teamIds in. Callers use this to color-key their standings lists. */
export function getTeamColor(teamId: string, teamIds: string[]): string {
  const idx = [...teamIds].sort().indexOf(teamId)
  return TEAM_COLORS[(idx < 0 ? 0 : idx) % TEAM_COLORS.length]
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// Mario-Party-style bump chart: y-axis is POSITION (1st place = top lane), not score.
// Lines cross whenever teams swap places, so comebacks and collapses read as literal
// crossings. No in-chart name labels — lines run the full width, and tapping a line
// (or its end dot) selects that team in the detail bar below the chart.
//
// DOM order is FIXED (teamIds order); the selected team renders as a separate overlay
// path instead of being re-sorted on top. Re-sorting keyed SVG children moves DOM nodes,
// which restarts their CSS intro animations — the whole chart would blank and redraw on
// every tap. Same reason `drew` freezes the intro styles once the animation finishes.
export default function ScoreHistoryChart({ snapshots, teamNames, teamIds, highlightTeamId }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(highlightTeamId ?? null)
  const [drew, setDrew] = useState(false)

  if (snapshots.length === 0 || teamIds.length === 0) return null

  // Build score-per-team for every step, starting from an all-zero "Start" point
  const steps: Array<Map<string, number>> = [
    new Map(teamIds.map(id => [id, 0])),
    ...snapshots.map(snap => {
      const m = new Map(teamIds.map(id => [id, 0]))
      snap.scores.forEach(({ team_id, score }) => { if (m.has(team_id)) m.set(team_id, score) })
      return m
    }),
  ]

  // Position (0-based lane) per team at each step. Ties keep their previous order so
  // lines don't jitter when scores are equal (especially the all-zero start).
  let prevPos = new Map(teamIds.map((id, i) => [id, i]))
  const positions: Array<Map<string, number>> = steps.map(scoreMap => {
    const sorted = [...teamIds].sort((a, b) =>
      (scoreMap.get(b) ?? 0) - (scoreMap.get(a) ?? 0) ||
      (prevPos.get(a) ?? 0) - (prevPos.get(b) ?? 0)
    )
    const pos = new Map(sorted.map((id, i) => [id, i]))
    prevPos = pos
    return pos
  })

  // ── Geometry (viewBox units; SVG scales to fit its container) ──
  const N = teamIds.length
  const S = steps.length
  const W = 1000
  const PAD_L = 24
  const PAD_R = 40
  const PAD_T = 18
  const PAD_B = 40
  const ROW_H = 64
  const H = PAD_T + N * ROW_H + PAD_B
  const plotR = W - PAD_R
  const x = (i: number) => S > 1 ? PAD_L + (i * (plotR - PAD_L)) / (S - 1) : PAD_L
  const y = (pos: number) => PAD_T + pos * ROW_H + ROW_H / 2

  const finalScores = steps[S - 1]
  const finalPositions = positions[S - 1]

  const pathOf = (id: string) =>
    steps.map((_, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(positions[i].get(id) ?? 0).toFixed(1)}`).join(' ')

  // Intro animation styles, frozen to their end state once the intro has played
  const lineStyle = drew
    ? { strokeDasharray: 1, strokeDashoffset: 0 }
    : {
        strokeDasharray: 1,
        strokeDashoffset: 1,
        animation: 'bump-draw 2.2s cubic-bezier(0.4, 0, 0.2, 1) 0.2s forwards',
      }
  const dotStyle = (extra: React.CSSProperties): React.CSSProperties => drew
    ? { opacity: 1, ...extra }
    : { opacity: 0, animation: 'bump-label-in 0.5s ease-out 1.7s forwards', ...extra }

  const toggle = (id: string) => setSelectedId(prev => prev === id ? null : id)

  const selName  = selectedId ? (teamNames.get(selectedId) ?? '?') : null
  const selScore = selectedId ? (finalScores.get(selectedId) ?? 0) : 0
  const selPos   = selectedId ? (finalPositions.get(selectedId) ?? 0) : 0
  const selColor = selectedId ? getTeamColor(selectedId, teamIds) : '#6b7280'

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          {/* Lane guides — one per position slot */}
          {Array.from({ length: N }, (_, i) => (
            <line key={i} x1={PAD_L} y1={y(i)} x2={plotR} y2={y(i)}
              stroke="#1f2937" strokeWidth={1.5} strokeDasharray="3 8" />
          ))}

          {/* Step ticks along the baseline */}
          {Array.from({ length: S }, (_, i) => (
            <line key={i} x1={x(i)} y1={H - PAD_B + 6} x2={x(i)} y2={H - PAD_B + 14}
              stroke="#374151" strokeWidth={2} />
          ))}
          <text x={PAD_L} y={H - 8} fill="#6b7280" fontSize={22} fontWeight={700}
            style={{ letterSpacing: '0.15em' }}>
            START
          </text>
          <text x={plotR} y={H - 8} fill="#6b7280" fontSize={22} fontWeight={700}
            textAnchor="end" style={{ letterSpacing: '0.15em' }}>
            FINAL
          </text>

          {/* Team lines — fixed order; first one reports the intro animation finishing */}
          {teamIds.map((id, i) => (
            <path key={id} d={pathOf(id)} fill="none"
              stroke={getTeamColor(id, teamIds)}
              strokeWidth={6.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={selectedId != null && id !== selectedId ? 0.35 : 0.85}
              pathLength={1}
              style={lineStyle}
              onAnimationEnd={i === 0 ? () => setDrew(true) : undefined}
            />
          ))}

          {/* Selected team's bold overlay line (stable key — never re-animates on switch) */}
          {selectedId && (
            <path key="sel-line" d={pathOf(selectedId)} fill="none"
              stroke={selColor}
              strokeWidth={11}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              style={lineStyle}
            />
          )}

          {/* End dots */}
          {teamIds.map(id => (
            <circle key={id} cx={plotR} cy={y(finalPositions.get(id) ?? 0)}
              r={id === selectedId ? 14 : 10}
              fill={getTeamColor(id, teamIds)}
              style={dotStyle({ cursor: 'pointer' })}
              onClick={() => toggle(id)}
            />
          ))}

          {/* Invisible fat hit-paths on top: make thin lines tappable on phones */}
          {teamIds.map(id => (
            <path key={id} d={pathOf(id)} fill="none"
              stroke="#000" strokeOpacity={0} strokeWidth={30}
              strokeLinecap="round" strokeLinejoin="round"
              style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={() => toggle(id)}
            />
          ))}
        </svg>
      </div>

      {/* Detail bar — who the selected line is */}
      <div className="shrink-0 mt-2 flex items-center justify-center">
        {selectedId && selName ? (
          <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2 max-w-full"
            style={{ borderColor: `${selColor}55` }}>
            <span className="rounded-full shrink-0"
              style={{ width: 'clamp(10px, 1.2vw, 16px)', height: 'clamp(10px, 1.2vw, 16px)', background: selColor }} />
            <span className="font-black shrink-0" style={{ color: selColor, fontSize: 'clamp(0.9rem, 1.8vw, 1.4rem)' }}>
              {ordinal(selPos + 1)}
            </span>
            <span className="font-bold text-white truncate" style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.4rem)' }}>
              {selName}
            </span>
            <span className={`font-mono font-black tabular-nums shrink-0 ${selScore < 0 ? 'text-red-400' : 'text-yellow-400'}`}
              style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.4rem)' }}>
              {selScore.toLocaleString()}
            </span>
          </div>
        ) : (
          <p className="text-gray-600 py-2" style={{ fontSize: 'clamp(0.75rem, 1.4vw, 1.1rem)' }}>
            Tap a line to see whose it is
          </p>
        )}
      </div>
    </div>
  )
}
