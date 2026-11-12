import { defineEventHandler, setHeaders, getHeader, getRequestURL, createError } from 'h3'

export default defineEventHandler(event => {
  setHeaders(event, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off'
  })
  if (!import.meta.dev) {
    setHeaders(event, {
      'Strict-Transport-Security': 'max-age=31536000',
      // Nuxt SSR uses inline bootstrap data/scripts. Keep eval disallowed and narrow
      // other resource types; nonce-based script CSP remains a deployment task.
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
    })
  }
  const url = getRequestURL(event)
  if (url.pathname.toLowerCase().startsWith('/api/')) {
    setHeaders(event, { 'Cache-Control': 'no-store, private', 'Vary': 'Authorization, Origin' })
    const origin = getHeader(event, 'origin')
    if (getHeader(event, 'sec-fetch-site') === 'cross-site' || (origin && origin !== url.origin)) {
      throw createError({ statusCode: 403, data: { message: '不允許跨網站呼叫。' } })
    }
  }
})
