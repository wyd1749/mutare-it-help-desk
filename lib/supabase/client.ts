import { createBrowserClient } from '@supabase/ssr'
import { processLock } from '@supabase/supabase-js'
import type { Database } from './types'

let cachedClient: ReturnType<typeof createBrowserClient<Database>> | null = null

export function createClient() {
  if (cachedClient) return cachedClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  if (!url || !anonKey) {
    if (typeof window !== 'undefined') {
      console.warn(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Falling back to dummy configuration.'
      )
    }
  }

  cachedClient = createBrowserClient<Database>(url, anonKey, {
    auth: {
      lock: processLock,
    },
  })
  return cachedClient
}

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)