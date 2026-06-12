const MUSCLE_COLORS: Record<string, string> = {
  chest: '#ef4444',
  back: '#3b82f6',
  quads: '#f97316',
  hamstrings: '#f59e0b',
  glutes: '#ec4899',
  shoulders: '#8b5cf6',
  biceps: '#06b6d4',
  triceps: '#14b8a6',
  core: '#84cc16',
  calves: '#6366f1',
  forearms: '#6b7280',
}

interface Props {
  data: Record<string, number>
}

export default function MuscleSplit({ data }: Props) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a)
  const total = entries.reduce((s, [, v]) => s + v, 0)

  if (entries.length === 0) {
    return (
      <div className="card p-4">
        <span className="text-sm font-semibold text-gray-900 block mb-3">Muscle split</span>
        <p className="text-sm text-gray-400 text-center py-4">
          No data yet. Log a few sessions to see your muscle split.
        </p>
      </div>
    )
  }

  return (
    <div className="card p-4">
      <span className="text-sm font-semibold text-gray-900 block mb-3">Muscle split (last 4 weeks)</span>
      <div className="space-y-2">
        {entries.map(([muscle, vol]) => {
          const pct = total > 0 ? Math.round((vol / total) * 100) : 0
          const color = MUSCLE_COLORS[muscle] ?? '#9ca3af'
          return (
            <div key={muscle} className="flex items-center gap-2">
              <span className="text-xs text-gray-600 w-20 capitalize">{muscle}</span>
              <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
