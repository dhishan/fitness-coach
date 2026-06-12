import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../store/auth'
import { usageApi } from '../services/api'

interface Props {
  open: boolean
  onClose: () => void
}

const UNIT_KEY = 'fitness-unit-pref'

export default function SettingsSheet({ open, onClose }: Props) {
  const { user, logout } = useAuth()
  const [unit, setUnitState] = useState<'kg' | 'lb'>(() => {
    return (localStorage.getItem(UNIT_KEY) as 'kg' | 'lb') ?? 'kg'
  })

  const { data: usage, isLoading: loadingUsage } = useQuery({
    queryKey: ['usage-summary'],
    queryFn: () => usageApi.summary(),
    enabled: open,
  })

  const setUnit = (u: 'kg' | 'lb') => {
    localStorage.setItem(UNIT_KEY, u)
    setUnitState(u)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="card relative w-full max-w-lg p-6 rounded-b-none z-10 safe-bottom">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-sm"
            aria-label="Close settings"
          >
            &#x2715;
          </button>
        </div>

        {/* Account */}
        <div className="mb-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Account</p>
          <p className="text-sm text-gray-700 break-all">{user?.email ?? '-'}</p>
        </div>

        {/* Weight unit */}
        <div className="mb-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Weight display</p>
          <div className="flex gap-2">
            {(['kg', 'lb'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  unit === u
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        {/* Monthly usage */}
        <div className="mb-6">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Coach usage this month</p>
          {loadingUsage ? (
            <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
          ) : usage ? (
            <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-gray-600">
                {usage.input_tokens.toLocaleString()} in / {usage.output_tokens.toLocaleString()} out tokens
              </span>
              <span className="text-xs font-semibold text-gray-800">
                ${usage.cost_usd.toFixed(4)}
              </span>
            </div>
          ) : (
            <p className="text-xs text-gray-400">No usage data yet.</p>
          )}
        </div>

        {/* Sign out */}
        <button
          onClick={() => {
            logout()
            onClose()
          }}
          className="w-full py-2.5 rounded-lg bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
