'use client'

import { useEffect } from 'react'

export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal: the app still works without a service worker, it just
      // won't be installable / won't have the offline-shell fallback.
    })
  }, [])

  return null
}
