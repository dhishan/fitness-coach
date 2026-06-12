import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useAuth } from './store/auth'
import Login from './pages/Login'
import Home from './pages/Home'
import Workout from './pages/Workout'
import History from './pages/History'
import Coach from './pages/Coach'
import SettingsSheet from './components/SettingsSheet'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
})

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function WorkoutIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="4" rx="2" />
      <rect x="1" y="11" width="3" height="2" rx="1" />
      <rect x="20" y="11" width="3" height="2" rx="1" />
      <rect x="7" y="7" width="2" height="4" rx="1" />
      <rect x="15" y="7" width="2" height="4" rx="1" />
      <rect x="7" y="13" width="2" height="4" rx="1" />
      <rect x="15" y="13" width="2" height="4" rx="1" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function CoachIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

const tabs = [
  { path: '/', label: 'Home', Icon: HomeIcon },
  { path: '/workout', label: 'Workout', Icon: WorkoutIcon },
  { path: '/history', label: 'History', Icon: HistoryIcon },
  { path: '/coach', label: 'Coach', Icon: CoachIcon },
]

function AuthedLayout() {
  const { token, user } = useAuth()
  const location = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  const initials = user?.display_name
    ? user.display_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100 safe-top">
        <div className="flex items-center justify-between px-4 h-14">
          <span className="text-base font-semibold text-gray-900">Fitness Tracker</span>
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-xs font-semibold"
            aria-label="Settings"
          >
            {initials}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-y-auto">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/workout" element={<Workout />} />
          <Route path="/history" element={<History />} />
          <Route path="/coach" element={<Coach />} />
        </Routes>
      </main>

      <nav className="sticky bottom-0 z-40 bg-white border-t border-gray-100 safe-bottom">
        <div className="flex">
          {tabs.map(({ path, label, Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
                  isActive ? 'text-primary-500' : 'text-gray-400'
                }`
              }
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<AuthedLayout />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" />
    </QueryClientProvider>
  )
}
