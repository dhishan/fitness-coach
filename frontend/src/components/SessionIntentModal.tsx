/**
 * Pre-workout intent modal (web). Captures optional goal + energy/mental/physical
 * on a 1-10 scale, which the next-exercise AI suggestion uses.
 */
import { useState } from 'react'

export type SessionIntent = {
  goal: string
  energy: number | null
  mental: number | null
  physical: number | null
}

type Props = {
  open: boolean
  starting: boolean
  onCancel: () => void
  onStart: (intent: SessionIntent) => void
}

function ScaleRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-800 mb-1">{label}</div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`w-8 h-9 rounded-md text-xs font-semibold border transition ${
              value === n
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SessionIntentModal({ open, starting, onCancel, onStart }: Props) {
  const [goal, setGoal] = useState('')
  const [energy, setEnergy] = useState<number | null>(null)
  const [mental, setMental] = useState<number | null>(null)
  const [physical, setPhysical] = useState<number | null>(null)

  if (!open) return null

  const reset = () => {
    setGoal('')
    setEnergy(null)
    setMental(null)
    setPhysical(null)
  }

  const submit = () => {
    onStart({ goal: goal.trim(), energy, mental, physical })
    reset()
  }

  const skip = () => {
    onStart({ goal: '', energy: null, mental: null, physical: null })
    reset()
  }

  const cancel = () => {
    reset()
    onCancel()
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[88vh] overflow-y-auto shadow-xl">
        <div className="p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">How are you feeling?</h2>
            <p className="text-sm text-gray-500">
              Tell the coach what to aim for today. All optional.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Goal (optional)
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              maxLength={200}
              placeholder="e.g. push day, focus on chest"
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <ScaleRow label="Energy" value={energy} onChange={setEnergy} />
          <ScaleRow label="Mental" value={mental} onChange={setMental} />
          <ScaleRow label="Physical" value={physical} onChange={setPhysical} />
          <p className="text-[11px] text-gray-400 italic">
            1 = wrecked &nbsp;·&nbsp; 10 = ready to PR
          </p>
        </div>

        <div className="flex gap-2 p-4 border-t border-gray-100">
          <button
            type="button"
            onClick={skip}
            disabled={starting}
            className="px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={starting}
            className="flex-1 px-3 py-2 text-sm font-medium border border-gray-200 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={starting}
            className="flex-1 px-3 py-2 text-sm font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {starting ? '...' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  )
}
