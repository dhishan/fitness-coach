import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { authApi } from '../services/api'
import { useAuth } from '../store/auth'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (
            element: HTMLElement,
            options: { theme?: string; size?: string; width?: number }
          ) => void
        }
      }
    }
  }
}

export default function Login() {
  const navigate = useNavigate()
  const { setAuth, token } = useAuth()
  const buttonRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (token) {
      navigate('/', { replace: true })
      return
    }

    function initGIS() {
      if (!window.google || !buttonRef.current) return
      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID as string,
        callback: async (response) => {
          try {
            const data = await authApi.google(response.credential)
            setAuth(data.access_token, data.user)
            navigate('/', { replace: true })
          } catch (err: unknown) {
            const status = (err as { response?: { status?: number } })?.response?.status
            if (status === 403) {
              toast.error('This app is invite-only.')
            } else {
              toast.error('Sign-in failed. Please try again.')
            }
          }
        },
      })
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 280,
      })
    }

    if (window.google) {
      initGIS()
    } else {
      const interval = setInterval(() => {
        if (window.google) {
          clearInterval(interval)
          initGIS()
        }
      }, 100)
      return () => clearInterval(interval)
    }
  }, [token, setAuth, navigate])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm flex flex-col items-center gap-6">
        <div className="text-center">
          <div className="w-14 h-14 bg-primary-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="14" width="4" height="4" rx="2" fill="white" />
              <rect x="24" y="14" width="4" height="4" rx="2" fill="white" />
              <rect x="8" y="10" width="16" height="12" rx="2" fill="white" />
              <rect x="12" y="7" width="3" height="5" rx="1.5" fill="white" />
              <rect x="17" y="7" width="3" height="5" rx="1.5" fill="white" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Fitness Tracker</h1>
          <p className="text-sm text-gray-500 mt-1">Track your training, talk to your coach.</p>
        </div>
        <div ref={buttonRef} />
        <p className="text-center text-xs text-gray-400 mt-6">
          <a href="/privacy" className="hover:underline">Privacy Policy</a>
          <span className="mx-2">&middot;</span>
          <a href="/terms" className="hover:underline">Terms of Service</a>
        </p>
      </div>
    </div>
  )
}
