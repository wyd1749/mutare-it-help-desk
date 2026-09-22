import { createBrowserClient } from '@supabase/ssr'
import { processLock } from '@supabase/supabase-js'
import type { Database } from './types'

// The whole app (app/page.tsx) is a single 'use client' component, so a
// browser client is all this project needs. If you later add server
// components, server actions, or route handlers that talk to Supabase,
// add a matching server.ts using createServerClient from '@supabase/ssr'.
//
// This is memoized to a single instance. Every query function calls
// createClient(), and several of them run concurrently (e.g. the initial
// Promise.all of employees/tickets/activities/articles/settings) — building
// a fresh client (and therefore a fresh internal auth client) on every call
// spins up that many instances at once, which can deadlock on the browser's
// Web Locks API that Supabase uses to guard the stored session. Reusing one
// instance avoids that entirely.
let cachedClient: ReturnType<typeof createBrowserClient<Database>> | null = null

export function createClient() {
  if (cachedClient) return cachedClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copy .env.local.example to .env.local and fill in your Supabase project values.'
    )
  }

  cachedClient = createBrowserClient<Database>(url, anonKey, {
    auth: {
      // Default lock uses navigator.locks, which can get orphaned by React
      // Strict Mode's dev-mode mount→unmount→remount cycle and then hang
      // every subsequent auth call forever (supabase-js#2111). processLock
      // is in-memory and scoped to this tab's JS context, so it can't be
      // left held by a torn-down effect the way navigator.locks can.
      lock: processLock,
    },
  })
  return cachedClient
}

// Whether Supabase is configured at all. Lets the app fall back to the
// built-in demo data (initialEmployees/initialTechnicians/initialTickets)
// instead of crashing when no project is connected yet.
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)