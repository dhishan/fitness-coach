const CACHE = 'ft-' + (new URL(self.location).searchParams.get('v') || 'dev')
const API_HOST = 'api.fitness-tracker.blueelephants.org'

self.addEventListener('install', (event) => {
  // Do not skipWaiting automatically - prompt mode only
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/'])))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Network-only for API calls
  if (url.pathname.includes('/api/') || url.hostname === API_HOST) {
    event.respondWith(fetch(event.request))
    return
  }

  // Cache-first for same-origin built assets
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone()
              caches.open(CACHE).then((cache) => cache.put(event.request, clone))
            }
            return response
          })
      )
    )
    return
  }

  event.respondWith(fetch(event.request))
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
