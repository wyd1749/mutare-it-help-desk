import { timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function secretMatches(header: string | null): boolean {
  const expected = process.env.PUSH_WEBHOOK_SECRET
  if (!expected || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Called by a Supabase Database Webhook on every INSERT/UPDATE of `tickets`.
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get('x-webhook-secret'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await request.json().catch(() => null)
  const record = payload?.record
  const oldRecord = payload?.old_record
  if (payload?.table !== 'tickets' || !record?.assignee_id) {
    return Response.json({ skipped: 'not an assigned ticket' })
  }

  // Alert only when a ticket becomes assigned or is reassigned — not on
  // every status/priority edit.
  const newlyAssigned =
    payload.type === 'INSERT' || (payload.type === 'UPDATE' && oldRecord?.assignee_id !== record.assignee_id)
  if (!newlyAssigned) return Response.json({ skipped: 'assignee unchanged' })

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('endpoint,p256dh,auth,employees!inner(role)')
    .eq('employees.role', 'Senior Technician')
  if (error) {
    console.error('push: could not load subscriptions', error)
    return Response.json({ error: 'Could not load subscriptions' }, { status: 500 })
  }

  const location = [record.door_number, record.department].filter(Boolean).join(' · ')
  const message = JSON.stringify({
    title: 'Check the IT service monitor',
    body: `New issue assigned${location ? ` — ${location}` : ''}: ${record.title}`,
    tag: record.id, // same tag the in-page notification uses, so they replace each other
    url: '/',
  })

  const results = await Promise.allSettled(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          message,
          { TTL: 3600, urgency: 'high' }
        )
      } catch (err: any) {
        // 404/410 = the browser unsubscribed or the subscription expired.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          return
        }
        throw err
      }
    })
  )

  const failed = results.filter((r) => r.status === 'rejected')
  failed.forEach((r) => console.error('push: send failed', (r as PromiseRejectedResult).reason))
  return Response.json({ sent: results.length - failed.length, failed: failed.length })
}
