import { createClient } from './client'
import type { Employee } from './queries'

export async function signIn(email: string, password: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function createTeamMember(input: {
  name: string
  email: string
  department: string
  role: 'Employee' | 'Technician' | 'Administrator'
  password: string
}): Promise<Employee> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('You are signed out. Sign in again and retry.')
  const res = await fetch('/api/admin/create-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || 'Could not create the account.')
  return body.employee as Employee
}

export async function signOut(): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export function onAuthStateChange(callback: (event: string, hasSession: boolean) => void): () => void {
  const supabase = createClient()
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, Boolean(session))
  })
  return () => subscription.unsubscribe()
}

export async function fetchCurrentEmployee(): Promise<Employee | null> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('employees')
    .select('id,name,email,department,role,status')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return data as Employee | null
}