# Vendored code notes

## mcp_oauth_worker.js (@cloudflare/workers-oauth-provider)

- `encryptProps`/`decryptProps` use an ALL-ZERO 12-byte AES-GCM IV. This is
  currently safe only because a fresh key is generated per encryption
  (single-use key = no IV reuse). If the library is ever updated or the grant
  encryption key is reused across two `encryptProps` calls, this becomes a
  catastrophic GCM keystream reuse. On any library bump: verify the IV handling
  before deploying.
