import { useEffect, useState } from 'react'

export default function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.ready.then((reg) => {
      // Already waiting on load
      if (reg.waiting) {
        setWaiting(reg.waiting)
      }

      // New SW found after update check
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(newWorker)
          }
        })
      })
    })

    // When controller changes (after skipWaiting), reload
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true
        window.location.reload()
      }
    })
  }, [])

  if (!waiting) return null

  function handleReload() {
    waiting!.postMessage({ type: 'SKIP_WAITING' })
  }

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-gray-900 text-white rounded-xl px-4 py-3 flex items-center justify-between shadow-lg">
        <span className="text-sm">New version available.</span>
        <button
          onClick={handleReload}
          className="ml-4 text-sm font-semibold text-primary-400 hover:text-primary-300 whitespace-nowrap"
        >
          Reload
        </button>
      </div>
    </div>
  )
}
