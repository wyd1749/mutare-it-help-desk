import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Sends a "ring" push to the person being called, so their device alerts them
// even when the site is closed. The caller is identified from their session
// token, and must really be the caller on that call.
//
// Uses the same VAPID keys as your existing push notifications. If your
// existing notify route names these environment variables differently, change
// the three names below to match.
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const callId: unknown = body?.callId
  if (typeof callId !== 'string' || callId.length > 64) {
    return Response.json({ error: 'Invalid call' }, { status: 400 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const email = userData?.user?.email
  if (userError || !email) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const escaped = email.replace(/[\\%_]/g, '\\$&')
  const { data: employee } = await admin.from('employees').select('id').ilike('email', escaped).maybeSingle()
  if (!employee) return Response.json({ error: 'No matching employee record' }, { status: 403 })

  const { data: call } = await admin
    .from('calls')
    .select('id,caller_id,callee_id,caller_name,status,created_at')
    .eq('id', callId)
    .maybeSingle()
  if (!call || call.caller_id !== employee.id) return Response.json({ error: 'Not your call' }, { status: 403 })

  // Only ring for a call that is still ringing and brand new.
  const ageMs = Date.now() - new Date(call.created_at).getTime()
  if (call.status !== 'ringing' || ageMs > 60_000) return Response.json({ ok: true, sent: 0 })

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return Response.json({ error: 'Push is not configured' }, { status: 503 })
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint,p256dh,auth')
    .eq('employee_id', call.callee_id)
  if (!subs || subs.length === 0) return Response.json({ ok: true, sent: 0 })

  const payload = JSON.stringify({
    type: 'call',
    title: `Incoming call from ${call.caller_name ?? 'a colleague'}`,
    body: 'Tap to open the service desk and answer.',
    tag: 'incoming-call',
    url: '/',
  })

  let sent = 0
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 30,
          urgency: 'high',
        })
        sent++
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        } else {
          console.error('call push failed', status)
        }
      }
    })
  )
  return Response.json({ ok: true, sent })
}