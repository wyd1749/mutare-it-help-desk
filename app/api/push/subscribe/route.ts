import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Roles that may receive background alerts. Add 'Technician' here later if
// assigned technicians should get pushes too.
const ALLOWED_ROLES = ['Senior Technician']

export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const endpoint: unknown = body?.endpoint
  const p256dh: unknown = body?.keys?.p256dh
  const auth: unknown = body?.keys?.auth
  if (
    typeof endpoint !== 'string' ||
    !endpoint.startsWith('https://') ||
    typeof p256dh !== 'string' ||
    typeof auth !== 'string'
  ) {
    return Response.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  // Identify the caller from their Supabase session token, never from
  // anything the browser claims about itself.
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const email = userData?.user?.email
  if (userError || !email) return Response.json({ error: 'Not signed in' }, { status: 401 })

  // Match the signed-in account to its row in `employees` by email.
  const escaped = email.replace(/[\\%_]/g, '\\$&')
  const { data: employee } = await admin
    .from('employees')
    .select('id,role')
    .ilike('email', escaped)
    .maybeSingle()
  if (!employee) return Response.json({ error: 'No matching employee record' }, { status: 403 })
  if (!ALLOWED_ROLES.includes(employee.role)) {
    return Response.json({ error: 'This role does not receive background alerts' }, { status: 403 })
  }

  const { error } = await admin
    .from('push_subscriptions')
    .upsert({ endpoint, employee_id: employee.id, p256dh, auth }, { onConflict: 'endpoint' })
  if (error) {
    console.error('push subscribe failed', error)
    return Response.json({ error: 'Could not save subscription' }, { status: 500 })
  }
  return Response.json({ ok: true })
}
