import type { DashboardSummary } from '@fitness/shared-types'

interface Props {
  summary: DashboardSummary
}

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function WeekStrip({ summary }: Props) {
  const weekStart = new Date(summary.week_start + 'T00:00:00')
  const trainedSet = new Set(summary.trained_dates)

  const dots = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { label: DAY_LABELS[i], iso, trained: trainedSet.has(iso) }
  })

  const volumeLabel =
    summary.week_volume >= 1000
      ? `${(summary.week_volume / 1000).toFixed(1)}k kg`
      : `${summary.week_volume} kg`

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">This week</span>
        <div className="flex items-center gap-2">
          {summary.streak_weeks > 0 && (
            <span className="text-xs bg-primary-100 text-primary-700 font-semibold px-2 py-0.5 rounded-full">
              {summary.streak_weeks}w streak
            </span>
          )}
          <span className="text-xs text-gray-500">{volumeLabel} total</span>
        </div>
      </div>
      <div className="flex justify-between">
        {dots.map((dot, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                dot.trained
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-400'
              }`}
            />
            <span className="text-xs text-gray-400">{dot.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-2 text-center">
        {summary.sessions_this_week === 0
          ? 'No sessions yet this week'
          : `${summary.sessions_this_week} session${summary.sessions_this_week === 1 ? '' : 's'} this week`}
      </p>
    </div>
  )
}
