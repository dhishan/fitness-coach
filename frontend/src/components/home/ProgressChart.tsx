import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { Exercise } from '@fitness/shared-types'
import { dashboardApi, exercisesApi } from '../../services/api'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

function Skeleton() {
  return <div className="h-40 bg-gray-100 rounded-lg animate-pulse" />
}

export default function ProgressChart() {
  const [selectedId, setSelectedId] = useState<string>('')

  const { data: exercises, isLoading: loadingEx } = useQuery<Exercise[]>({
    queryKey: ['exercises'],
    queryFn: () => exercisesApi.list(),
  })

  const { data: progress, isLoading: loadingProgress } = useQuery({
    queryKey: ['exercise-progress', selectedId],
    queryFn: () => dashboardApi.exerciseProgress(selectedId),
    enabled: !!selectedId,
  })

  const currentId = selectedId || (exercises && exercises.length > 0 ? exercises[0].id : '')

  const { data: progressForFirst } = useQuery({
    queryKey: ['exercise-progress', currentId],
    queryFn: () => dashboardApi.exerciseProgress(currentId),
    enabled: !!currentId && !selectedId,
  })

  const displayData = selectedId ? progress : progressForFirst

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Progress</span>
      </div>

      {loadingEx ? (
        <Skeleton />
      ) : !exercises || exercises.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          No exercises yet. Start your first session.
        </p>
      ) : (
        <>
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 mb-3 bg-white"
            value={selectedId || currentId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {exercises.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}
              </option>
            ))}
          </select>

          {loadingProgress && <Skeleton />}

          {!loadingProgress && (!displayData || displayData.length === 0) && (
            <p className="text-sm text-gray-400 text-center py-6">
              Not enough data yet. Log a few sessions.
            </p>
          )}

          {!loadingProgress && displayData && displayData.length > 0 && (
            <Line
              data={{
                labels: displayData.map((p) => p.date),
                datasets: [
                  {
                    label: 'Top weight (kg)',
                    data: displayData.map((p) => p.top_weight),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.1)',
                    yAxisID: 'y',
                    tension: 0.3,
                    pointRadius: 3,
                  },
                  {
                    label: 'Volume (kg)',
                    data: displayData.map((p) => p.volume),
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249,115,22,0.1)',
                    yAxisID: 'y2',
                    tension: 0.3,
                    pointRadius: 3,
                  },
                ],
              }}
              options={{
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
                scales: {
                  y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'kg', font: { size: 10 } } },
                  y2: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'vol', font: { size: 10 } }, grid: { drawOnChartArea: false } },
                },
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
