import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const ROLES = ['Employee', 'Technician', 'Administrator'] as const
type RoleName = (typeof ROLES)[number]
const ID_PREFIX: Record<RoleName, string> = { Employee: 'EMP', Technician: 'TECH', Administrator: 'ADM' }
const EMAIL_DOMAIN = '@mutarecity.org'

const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return fail('Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local and restart the dev server.', 500)
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1. Who is calling? Verify their session token, then confirm they are an Administrator.
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return fail('Not signed in.', 401)
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData.user) return fail('Your session has expired. Sign in again.', 401)
  const { data: caller } = await admin
    .from('employees')
    .select('role')
    .eq('user_id', authData.user.id)
    .maybeSingle()
  if (caller?.role !== 'Administrator') return fail('Only administrators can create accounts.', 403)

  // 2. Validate the request.
  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('Invalid request.', 400)
  }
  const name = String(body?.name ?? '').trim()
  const email = String(body?.email ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')
  const department = String(body?.department ?? '').trim() || 'ICT'
  const role = body?.role as RoleName
  if (!name || !email || !password) return fail('Name, email and password are required.', 400)
  if (!ROLES.includes(role)) return fail('Role must be Employee, Technician or Administrator.', 400)
  if (!email.endsWith(EMAIL_DOMAIN)) return fail(`Email must end with ${EMAIL_DOMAIN}.`, 400)
  if (password.length < 8) return fail('Password must be at least 8 characters.', 400)

  // 3. Reject duplicates.
  const escaped = email.replace(/[\\%_]/g, (m) => '\\' + m)
  const { data: existing } = await admin.from('employees').select('id').ilike('email', escaped).maybeSingle()
  if (existing) return fail('Someone with that email already exists in the team.', 409)

  // 4. Next id for this role, e.g. EMP-007.
  const prefix = ID_PREFIX[role]
  const { data: ids } = await admin.from('employees').select('id').like('id', `${prefix}-%`)
  const next =
    Math.max(0, ...(ids ?? []).map((r: { id: string }) => parseInt(r.id.split('-')[1] ?? '0', 10) || 0)) + 1
  const id = `${prefix}-${String(next).padStart(3, '0')}`

  // 5. Create the employees row first, then the login. The existing
  //    on_auth_user_created trigger links them by email; we also set
  //    user_id explicitly below so it never depends on the trigger.
  const { error: insertError } = await admin
    .from('employees')
    .insert({ id, name, email, department, role, status: 'Invited' })
  if (insertError) return fail(`Could not save the employee: ${insertError.message}`, 500)

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email, so no email rate limit
    user_metadata: { name },
  })
  if (createError || !created.user) {
    await admin.from('employees').delete().eq('id', id) // roll back
    const msg = createError?.message ?? 'Unknown error'
    return fail(
      /already.*registered|already exists/i.test(msg)
        ? 'A login for that email already exists in Supabase Auth. Delete it under Authentication → Users, then try again.'
        : `Could not create the login: ${msg}`,
      400,
    )
  }

  const { data: employee, error: linkError } = await admin
    .from('employees')
    .update({ user_id: created.user.id, status: 'Active' })
    .eq('id', id)
    .select('id,name,email,department,role,status')
    .single()
  if (linkError) return fail(`Login created but linking failed: ${linkError.message}`, 500)

  return NextResponse.json({ employee }, { status: 201 })
}