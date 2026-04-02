interface TeamScore {
  id: string
  name: string
  score: number
}

interface Props {
  teams: TeamScore[]
  myTeamId?: string | null
  onClose: () => void
}

export default function ScoreOverlay({ teams, myTeamId, onClose }: Props) {
  const sorted = [...teams].sort((a, b) => b.score - a.score)

  return (
    <div
      className="fixed inset-0 z-[100] bg-gray-950/97 flex flex-col items-center justify-center p-6"
      onClick={onClose}
    >
      <p className="text-gray-500 text-xs uppercase tracking-widest mb-6">All Scores</p>
      <div className="w-full max-w-xs space-y-2 mb-8">
        {sorted.map((team, i) => (
          <div
            key={team.id}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
              team.id === myTeamId
                ? 'bg-yellow-400/10 border border-yellow-400/40'
                : 'bg-gray-900'
            }`}
          >
            <span className="text-gray-600 font-mono w-5 text-center text-sm shrink-0">{i + 1}</span>
            <span className="flex-1 font-semibold text-left text-white truncate">{team.name}</span>
            <span className={`font-mono font-black text-sm tabular-nums ${team.score < 0 ? 'text-red-400' : 'text-yellow-400'}`}>
              {team.score}
            </span>
          </div>
        ))}
      </div>
      <p className="text-gray-700 text-xs">Tap anywhere to close</p>
    </div>
  )
}
