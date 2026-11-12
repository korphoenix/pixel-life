import { env } from 'node:process'

// Reject privileged keys before Nuxt serializes public runtime configuration.
const publicKey = env.NUXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
let privileged = publicKey.startsWith('sb_secret_')
try {
  if (publicKey.split('.').length === 3) privileged ||= JSON.parse(atob(publicKey.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'
} catch { /* Invalid keys fail authentication, without printing their contents. */ }
if (privileged) throw new Error('Public Supabase config requires a publishable/anon key; remove the privileged key before starting.')

export default defineNuxtConfig({
  compatibilityDate: '2025-05-01',
  srcDir: '.',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  devServer: { host: '127.0.0.1' },
  sourcemap: { client: false, server: false },
  router: { options: { sensitive: true } },
  vite: { server: { fs: { deny: ['**/.env', '**/.env.*', '**/*.{crt,pem,key}', '**/.git/**', '**/.nuxt/dev/**', '**/.nuxt/dist/server/**', '**/.output/**', '**/private-assets/**', '**/server/**', '**/.npmrc', '**/.netrc'] } } },
  runtimeConfig: {
    public: { supabaseUrl: '', supabaseAnonKey: '' }
  },
  app: { head: { title: '生活亂入', htmlAttrs: { lang: 'zh-Hant' }, meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }] } }
})
