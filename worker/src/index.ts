/**
 * Fitness Tracker MCP OAuth gateway (Cloudflare Worker).
 *
 * Public, DCR-capable OAuth 2.1 provider for claude.ai / chatgpt.com custom
 * connectors. The human logs in with Google (upstream); the Worker issues its
 * own token; authenticated MCP requests are signed with a short-lived gateway
 * assertion and proxied to the FastAPI backend's /mcp/.
 *
 * Uses Cloudflare's @cloudflare/workers-oauth-provider, which implements the
 * authorize/token/register (DCR) endpoints + KV-backed token storage. We supply
 * the Google login handler and the MCP proxy.
 */
import OAuthProvider, { type AuthRequest, type OAuthHelpers } from '@cloudflare/workers-oauth-provider'

interface Env {
  OAUTH_PROVIDER: OAuthHelpers
  OAUTH_KV: KVNamespace
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  MCP_GATEWAY_SECRET: string
  BACKEND_MCP_URL: string
}

interface UserProps extends Record<string, unknown> {
  email: string
  sub: string
}

// --------------------------------------------------------------------------
// HS256 gateway assertion (shared secret with the backend)
// --------------------------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)))
}

async function signGatewayAssertion(props: UserProps, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: props.sub, email: props.email, iat: now, exp: now + 120 }
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${b64url(new Uint8Array(sig))}`
}

// --------------------------------------------------------------------------
// Google upstream login (the OAuth provider's "default handler")
// --------------------------------------------------------------------------

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1]
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(decodeURIComponent(escape(atob(b64))))
}

const googleHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/authorize') {
      // Parse the MCP client's OAuth request, stash it in `state`, send the
      // user to Google. No extra consent UI — Google's screen IS the consent.
      const reqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request)
      const state = b64urlJson(reqInfo)
      const g = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      g.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
      g.searchParams.set('redirect_uri', `${url.origin}/callback`)
      g.searchParams.set('response_type', 'code')
      g.searchParams.set('scope', 'openid email profile')
      g.searchParams.set('access_type', 'online')
      g.searchParams.set('prompt', 'consent')
      g.searchParams.set('state', state)
      return Response.redirect(g.href, 302)
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || !state) return new Response('missing code/state', { status: 400 })

      let reqInfo: AuthRequest
      try {
        reqInfo = JSON.parse(decodeURIComponent(escape(atob(state.replace(/-/g, '+').replace(/_/g, '/')))))
      } catch {
        return new Response('bad state', { status: 400 })
      }

      // Exchange the Google code (server-side, with our client secret).
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${url.origin}/callback`,
          grant_type: 'authorization_code',
        }),
      })
      if (!tokenRes.ok) return new Response('google token exchange failed', { status: 502 })
      const tok = (await tokenRes.json()) as { id_token?: string }
      if (!tok.id_token) return new Response('no id_token from google', { status: 502 })

      // The token came straight from Google's token endpoint over TLS, so the
      // id_token is authentic; still pin audience + require a verified email.
      const claims = decodeJwtPayload(tok.id_token)
      if (claims.aud !== env.GOOGLE_CLIENT_ID) return new Response('aud mismatch', { status: 401 })
      if (claims.email_verified !== true) return new Response('email not verified', { status: 403 })
      const email = String(claims.email || '').toLowerCase()
      const sub = String(claims.sub || '')
      if (!email || !sub) return new Response('missing identity', { status: 401 })

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: reqInfo,
        userId: email,
        metadata: { email },
        scope: reqInfo.scope,
        props: { email, sub } satisfies UserProps,
      })
      return Response.redirect(redirectTo, 302)
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('fitness-tracker MCP OAuth gateway', { status: 200 })
    }
    return new Response('not found', { status: 404 })
  },
}

// --------------------------------------------------------------------------
// MCP API handler — authenticated; props injected by the provider
// --------------------------------------------------------------------------

const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props: UserProps }): Promise<Response> {
    const props = ctx.props
    if (!props?.email || !props?.sub) return new Response('unauthorized', { status: 401 })

    const assertion = await signGatewayAssertion(props, env.MCP_GATEWAY_SECRET)

    // Forward to the backend MCP, swapping the Worker token for the signed
    // gateway assertion. Keep the bits the MCP transport needs.
    const headers = new Headers()
    const copy = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'origin']
    for (const h of copy) {
      const v = request.headers.get(h)
      if (v) headers.set(h, v)
    }
    headers.set('x-mcp-gateway-assertion', assertion)

    return fetch(env.BACKEND_MCP_URL, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    })
  },
}

// --------------------------------------------------------------------------

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: mcpApiHandler as never,
  defaultHandler: googleHandler as never,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register', // RFC 7591 DCR
  scopesSupported: ['openid', 'email', 'profile'],
})
