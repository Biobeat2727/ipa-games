import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

export type ScoreSnapshot = {
  label: string
  scores: Array<{ team_id: string; score: number }>
}

interface Props {
  snapshots: ScoreSnapshot[]
  teamNames: Map<string, string>
  /** All team IDs that should appear — needed so we can add Start (0) for everyone */
  teamIds: string[]
}

// Distinct colors that pop on dark backgrounds
const TEAM_COLORS = [
  '#f59e0b', // amber
  '#34d399', // emerald
  '#60a5fa', // blue
  '#f87171', // red
  '#a78bfa', // violet
  '#fb923c', // orange
  '#4ade80', // green
  '#38bdf8', // sky
]

export default function ScoreHistoryChart({ snapshots, teamNames, teamIds }: Props) {
  // Build chart data: always start with a "Start" point at 0 for all teams
  const startPoint: Record<string, number | string> = { round: 'Start' }
  teamIds.forEach(id => { startPoint[id] = 0 })

  const dataPoints = [startPoint, ...snapshots.map(snap => {
    const point: Record<string, number | string> = { round: snap.label }
    // Fill all teams — use 0 if a team isn't in the snapshot
    teamIds.forEach(id => { point[id] = 0 })
    snap.scores.forEach(({ team_id, score }) => { point[team_id] = score })
    return point
  })]

  // Y-axis: find min/max across all snapshots to give nice padding
  let allScores = teamIds.flatMap(id =>
    dataPoints.map(pt => (pt[id] as number) ?? 0)
  )
  const minScore = Math.min(0, ...allScores)
  const maxScore = Math.max(0, ...allScores)
  const pad = Math.max(100, Math.round((maxScore - minScore) * 0.15))
  const yMin = minScore - pad
  const yMax = maxScore + pad

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={dataPoints} margin={{ top: 16, right: 32, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="round"
          tick={{ fill: '#9ca3af', fontSize: 14, fontWeight: 600 }}
          axisLine={{ stroke: '#4b5563' }}
          tickLine={false}
        />
        <YAxis
          domain={[yMin, yMax]}
          tick={{ fill: '#9ca3af', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={60}
          tickFormatter={v => v.toLocaleString()}
        />
        {minScore < 0 && (
          <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: '#111827',
            border: '1px solid #374151',
            borderRadius: 12,
            color: '#f9fafb',
            fontSize: 13,
          }}
          formatter={(value: number, name: string) => [
            value.toLocaleString(),
            teamNames.get(name) ?? name,
          ]}
          labelStyle={{ color: '#d1d5db', fontWeight: 700, marginBottom: 4 }}
        />
        <Legend
          formatter={name => teamNames.get(name) ?? name}
          wrapperStyle={{ fontSize: 13, paddingTop: 8, color: '#d1d5db' }}
        />
        {teamIds.map((id, i) => (
          <Line
            key={id}
            type="monotone"
            dataKey={id}
            name={id}
            stroke={TEAM_COLORS[i % TEAM_COLORS.length]}
            strokeWidth={3}
            dot={{ r: 6, strokeWidth: 2, fill: '#111827' }}
            activeDot={{ r: 8 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
