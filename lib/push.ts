import { createClient } from '@/lib/supabase/client'

export type PushStatus = 'subscribed' | 'unsupported' | 'denied' | 'failed'

// The VAPID public key arrives base64url-encoded; the browser wants raw bytes.
function urlBase64ToUint8Array(base64: string) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

// Safe to call repeatedly: it reuses an existing browser subscription and the
// server upserts on the endpoint, so it never creates duplicates.
export async function subscribeToPush(): Promise<PushStatus> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'unsupported'
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!publicKey) {
    console.error('Push: NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set.')
    return 'failed'
  }

  try {
    const permission =
      Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    if (permission !== 'granted') return 'denied'

    const registration = await navigator.serviceWorker.ready
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }))

    const { data } = await createClient().auth.getSession()
    const token = data.session?.access_token
    if (!token) return 'failed'

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(subscription.toJSON()),
    })
    if (!res.ok) {
      console.error('Push: server rejected the subscription', res.status, await res.text())
      return 'failed'
    }
    return 'subscribed'
  } catch (err) {
    console.error('Push: could not subscribe', err)
    return 'failed'
  }
}
