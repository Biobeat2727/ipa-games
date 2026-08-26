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
  /** Controlled selection: pass both to drive selection from outside (e.g. a tappable
   *  standings list). When selectedTeamId is undefined the chart manages its own. */
  selectedTeamId?: string | null
  onSelectTeam?: (id: string | null) => void
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

/** Round a raw interval up to a friendly 1/2/5 × 10^k value for gridlines */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

// Score line chart: y-axis is POINTS. The scale runs from the highest score any team
// held at any moment of the game (top) down to the lowest (bottom), so every question's
// swing shows as a real vertical move. No in-chart name labels — lines run the full
// width, and tapping a line (or its end dot / score label) selects that team in the
// detail bar below the chart.
//
// DOM order is FIXED (teamIds order); the selected team renders as a separate overlay
// path instead of being re-sorted on top. Re-sorting keyed SVG children moves DOM nodes,
// which restarts their CSS intro animations — the whole chart would blank and redraw on
// every tap. Same reason `drew` freezes the intro styles once the animation finishes.
export default function ScoreHistoryChart({ snapshots, teamNames, teamIds, highlightTeamId, selectedTeamId, onSelectTeam }: Props) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(highlightTeamId ?? null)
  const controlled = selectedTeamId !== undefined
  const selectedId = controlled ? selectedTeamId : internalSelectedId
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

  // The y scale: highest and lowest score held at ANY point of the game
  let maxV = -Infinity
  let minV = Infinity
  steps.forEach(m => m.forEach(v => {
    if (v > maxV) maxV = v
    if (v < minV) minV = v
  }))
  if (maxV === minV) maxV = minV + 100 // degenerate all-equal case: keep a real range

  // ── Geometry (viewBox units; SVG scales to fit its container) ──
  const S = steps.length
  const W = 1000
  const PAD_L = 92  // room for the y-axis point labels
  const PAD_R = 118 // room for the final-score labels at the line ends
  const PAD_T = 26
  const PAD_B = 40
  const H = 640
  const plotR = W - PAD_R
  const plotB = H - PAD_B
  const range = maxV - minV
  const x = (i: number) => S > 1 ? PAD_L + (i * (plotR - PAD_L)) / (S - 1) : PAD_L
  const yOf = (v: number) => PAD_T + ((maxV - v) * (plotB - PAD_T)) / range

  const finalScores = steps[S - 1]

  // Final ranking (for the detail bar ordinal), ties broken stably by team order
  const finalRank = new Map(
    [...teamIds].sort((a, b) => (finalScores.get(b) ?? 0) - (finalScores.get(a) ?? 0))
      .map((id, i) => [id, i])
  )

  // Y gridlines on friendly values between the extremes; the exact max/min get their
  // own labels at the very top/bottom, and gridline labels too close to them yield.
  const step = niceStep(range / 4)
  const gridTicks: number[] = []
  // `v === 0 ? 0 : v` normalizes JS negative zero (Math.ceil of a negative fraction)
  for (let v = Math.ceil(minV / step) * step; v <= maxV + 1e-9; v += step) gridTicks.push(v === 0 ? 0 : v)
  const EDGE_GAP = 34
  const labeledTicks = gridTicks.filter(v =>
    yOf(v) > PAD_T + EDGE_GAP && yOf(v) < plotB - EDGE_GAP
  )

  // Which intermediate steps get an x-axis label — thinned to at most ~8 so long
  // rounds never crowd, and kept clear of the START/FINAL captions at the ends.
  const labelStride = Math.max(1, Math.ceil((S - 2) / 8))
  const xTickSteps = Array.from({ length: S }, (_, i) => i).filter(i =>
    i > 0 && i < S - 1 &&
    i % labelStride === 0 &&
    x(i) > PAD_L + 100 && x(i) < plotR - 100
  )

  // Right-edge final score labels sit at each line's end y — nudged apart so teams
  // that finish close together stay readable.
  const scoreLabelY: Map<string, number> = (() => {
    const MIN_GAP = 30
    const entries = teamIds
      .map(id => ({ id, y: yOf(finalScores.get(id) ?? 0) }))
      .sort((a, b) => a.y - b.y)
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].y - entries[i - 1].y < MIN_GAP) entries[i].y = entries[i - 1].y + MIN_GAP
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      const limit = i === entries.length - 1 ? plotB + 20 : entries[i + 1].y - MIN_GAP
      if (entries[i].y > limit) entries[i].y = limit
    }
    return new Map(entries.map(e => [e.id, e.y]))
  })()

  const pathOf = (id: string) =>
    steps.map((m, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${yOf(m.get(id) ?? 0).toFixed(1)}`).join(' ')

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

  const toggle = (id: string) => {
    const next = selectedId === id ? null : id
    if (!controlled) setInternalSelectedId(next)
    onSelectTeam?.(next)
  }

  const selName  = selectedId ? (teamNames.get(selectedId) ?? '?') : null
  const selScore = selectedId ? (finalScores.get(selectedId) ?? 0) : 0
  const selPos   = selectedId ? (finalRank.get(selectedId) ?? 0) : 0
  const selColor = selectedId ? getTeamColor(selectedId, teamIds) : '#6b7280'

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          {/* Y gridlines on friendly point values */}
          {gridTicks.map(v => (
            <line key={v} x1={PAD_L} y1={yOf(v)} x2={plotR} y2={yOf(v)}
              stroke={v === 0 ? '#374151' : '#1f2937'} strokeWidth={v === 0 ? 2 : 1.5}
              strokeDasharray={v === 0 ? undefined : '3 8'} />
          ))}
          {labeledTicks.map(v => (
            <text key={v} x={PAD_L - 14} y={yOf(v) + 8} fill="#4b5563" fontSize={22}
              fontWeight={600} textAnchor="end" fontFamily="ui-monospace, monospace">
              {v.toLocaleString()}
            </text>
          ))}

          {/* The y-axis extremes: highest and lowest score held at any point */}
          <text x={PAD_L - 14} y={PAD_T + 8} fill="#9ca3af" fontSize={24} fontWeight={800}
            textAnchor="end" fontFamily="ui-monospace, monospace">
            {maxV.toLocaleString()}
          </text>
          <text x={PAD_L - 14} y={plotB + 8} fill="#9ca3af" fontSize={24} fontWeight={800}
            textAnchor="end" fontFamily="ui-monospace, monospace">
            {minV.toLocaleString()}
          </text>

          {/* Step ticks along the baseline */}
          {Array.from({ length: S }, (_, i) => (
            <line key={i} x1={x(i)} y1={plotB + 6} x2={x(i)} y2={plotB + 14}
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

          {/* X-axis question numbers — where each swing happened during the round */}
          {xTickSteps.map(i => (
            <text key={i} x={x(i)} y={H - 8} fill="#4b5563" fontSize={20} fontWeight={600}
              textAnchor="middle" fontFamily="ui-monospace, monospace">
              {snapshots[i - 1]?.label ?? `#${i}`}
            </text>
          ))}

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
            <circle key={id} cx={plotR} cy={yOf(finalScores.get(id) ?? 0)}
              r={id === selectedId ? 14 : 10}
              fill={getTeamColor(id, teamIds)}
              style={dotStyle({ cursor: 'pointer' })}
              onClick={() => toggle(id)}
            />
          ))}

          {/* Final scores down the right edge, nudged apart when teams finish close */}
          {teamIds.map(id => (
            <text key={id} x={plotR + 18} y={(scoreLabelY.get(id) ?? yOf(finalScores.get(id) ?? 0)) + 9}
              fill={getTeamColor(id, teamIds)} fontSize={26}
              fontWeight={id === selectedId ? 800 : 700}
              fontFamily="ui-monospace, monospace"
              style={dotStyle({ cursor: 'pointer' })}
              onClick={() => toggle(id)}
            >
              {(finalScores.get(id) ?? 0).toLocaleString()}
            </text>
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
