// Tiny Cloudflare Worker that proxies https://apps.blueelephants.org/*
// to the public GCS bucket gs://blueelephants-altstore/*.
// Gives a pretty domain with HTTPS + cert managed by Cloudflare.

const BUCKET = "https://storage.googleapis.com/blueelephants-altstore"

export default {
  async fetch(req) {
    const url = new URL(req.url)
    // Default path -> altstore.json so https://apps.blueelephants.org works too
    const path = url.pathname === "/" ? "/altstore.json" : url.pathname
    const target = BUCKET + path

    const upstream = await fetch(target, { cf: { cacheTtl: 60 } })
    const headers = new Headers(upstream.headers)
    headers.set("access-control-allow-origin", "*")
    headers.set("cache-control", "public, max-age=60")
    return new Response(upstream.body, { status: upstream.status, headers })
  },
}
