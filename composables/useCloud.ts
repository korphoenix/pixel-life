import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null
export function useCloud() {
  const config = useRuntimeConfig()
  const configured = Boolean(config.public.supabaseUrl && config.public.supabaseAnonKey)
  // The client owns browser sessions only; server requests create their own scoped client.
  if (import.meta.client && configured && !client) {
    client = createClient(config.public.supabaseUrl, config.public.supabaseAnonKey)
  }
  return { configured, client: import.meta.client ? client : null }
}
