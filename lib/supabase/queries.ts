import { createClient } from './client'

// --- App-facing shapes (match the types already used in app/page.tsx) ---
export type Employee = {
  id: string
  name: string
  email: string
  department: string
  role: string
  status: 'Active' | 'Invited'
}

export type Ticket = {
  id: string
  title: string
  category: string
  requester: string
  department: string
  time: string
  priority: 'Critical' | 'High' | 'Medium' | 'Low'
  status: 'Open' | 'In progress' | 'Resolved'
  assignee: string
  description: string
}

export type Activity = {
  id: string
  user: string
  action: string
  time: string
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// --- Employees / technicians / admins (all rows in the `employees` table) ---

export async function fetchEmployees(): Promise<Employee[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('employees')
    .select('id,name,email,department,role,status')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as Employee[]
}

export async function createEmployee(input: {
  name: string
  email: string
  department: string
  role: 'Employee' | 'Technician' | 'Administrator'
}): Promise<Employee> {
  const supabase = createClient()
  const prefix = input.role === 'Technician' ? 'TECH' : input.role === 'Administrator' ? 'CTO' : 'EMP'
  const id = `${prefix}-${Date.now().toString().slice(-6)}`
  const { data, error } = await supabase
    .from('employees')
    .insert({ id, name: input.name, email: input.email, department: input.department, role: input.role, status: 'Invited' })
    .select('id,name,email,department,role,status')
    .single()
  if (error) throw error
  return data as Employee
}

// --- Tickets ---

export async function fetchTickets(): Promise<Ticket[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tickets')
    .select(
      'id,title,category,department,reported_at,priority,status,description,' +
        'requester:employees!tickets_requester_id_fkey(name),' +
        'assignee:employees!tickets_assignee_id_fkey(name)'
    )
    .order('reported_at', { ascending: false })
  if (error) throw error
  return (data as any[]).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    requester: row.requester?.name ?? 'Unknown',
    department: row.department,
    time: formatRelativeTime(row.reported_at),
    priority: row.priority,
    status: row.status,
    assignee: row.assignee?.name ?? 'Unassigned',
    description: row.description,
  }))
}

// Ticket ids look like IT-1000, IT-1001, ... `id` is the table's primary
// key (see supabase/schema.sql) and nothing generates it server-side, so
// the app has to pick one. This reads the highest existing IT-#### id and
// adds one; createTicket() below retries with the next number if another
// request grabs the same id first (a unique-violation, Postgres code 23505).
async function nextTicketId(supabase: ReturnType<typeof createClient>, attempt: number): Promise<string> {
  const { data, error } = await supabase.from('tickets').select('id').like('id', 'IT-%')
  if (error) throw error
  const highest = Math.max(999, ...(data ?? []).map((r: { id: string }) => parseInt(r.id.split('-')[1] ?? '0', 10) || 0))
  return `IT-${highest + 1 + attempt}`
}

export async function createTicket(
  input: {
    title: string
    category: string
    department: string
    priority: Ticket['priority']
    description: string
  },
  requesterId: string
): Promise<Ticket> {
  const supabase = createClient()
  let lastError: any = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = await nextTicketId(supabase, attempt)
    const { data, error } = await supabase
      .from('tickets')
      .insert({
        id,
        title: input.title,
        category: input.category,
        requester_id: requesterId,
        department: input.department,
        priority: input.priority,
        status: 'Open',
        assignee_id: null,
        description: input.description,
      })
      .select('id,title,category,department,reported_at,priority,status,description')
      .single()
    if (!error) {
      return {
        id: data.id,
        title: data.title,
        category: data.category,
        requester: '', // filled in by the caller, which already knows the signed-in employee's name
        department: data.department,
        time: formatRelativeTime(data.reported_at),
        priority: data.priority,
        status: data.status,
        assignee: 'Unassigned',
        description: data.description,
      }
    }
    lastError = error
    if (error.code !== '23505') throw error // anything other than "id already taken" is a real failure
  }
  throw lastError ?? new Error('Could not generate a unique ticket ID. Please try again.')
}

// `people` is the combined employees+technicians list, used to resolve the
// assignee's display name (stored on the ticket) back to an employees.id.
export async function updateTicket(ticket: Ticket, people: Employee[]): Promise<void> {
  const supabase = createClient()
  const assignee = people.find((p) => p.name === ticket.assignee)
  const { error } = await supabase
    .from('tickets')
    .update({
      status: ticket.status,
      priority: ticket.priority,
      assignee_id: assignee ? assignee.id : null,
    })
    .eq('id', ticket.id)
  if (error) throw error
}

// --- Activity log (Header's notification bell) ---
// RLS scopes this to your own activity, or every activity if you're an
// Administrator (see the activities_select_self_or_admin policy) — so an
// admin's bell fills up with everyone's actions, and an employee's or
// technician's only shows their own.

export async function fetchActivities(): Promise<Activity[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('activities')
    .select('id,action,created_at,employee:employees!activities_user_id_fkey(name)')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data as any[]).map((row) => ({
    id: row.id,
    user: row.employee?.name ?? 'Unknown',
    action: row.action,
    time: formatRelativeTime(row.created_at),
  }))
}

export async function logActivity(userId: string, action: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('activities').insert({ user_id: userId, action })
  if (error) throw error
}

// --- Ticket notes (internal, staff-only — see TicketDetail) ---

export type Note = {
  id: string
  author: string
  body: string
  time: string
}

export async function fetchNotes(ticketId: string): Promise<Note[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('ticket_notes')
    .select('id,body,created_at,author:employees!ticket_notes_author_id_fkey(name)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as any[]).map((row) => ({
    id: row.id,
    author: row.author?.name ?? 'Unknown',
    body: row.body,
    time: formatRelativeTime(row.created_at),
  }))
}

export async function createNote(ticketId: string, authorId: string, body: string): Promise<Note> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('ticket_notes')
    .insert({ ticket_id: ticketId, author_id: authorId, body })
    .select('id,body,created_at,author:employees!ticket_notes_author_id_fkey(name)')
    .single()
  if (error) throw error
  const row = data as any
  return { id: row.id, author: row.author?.name ?? 'Unknown', body: row.body, time: formatRelativeTime(row.created_at) }
}

// --- Knowledge base articles ---

export type Article = {
  id: string
  title: string
  category: string
  body: string
  author: string
  updatedAt: string
}

export async function fetchArticles(): Promise<Article[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('articles')
    .select('id,title,category,body,updated_at,author:employees!articles_author_id_fkey(name)')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data as any[]).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    body: row.body,
    author: row.author?.name ?? 'ICT Administration',
    updatedAt: formatRelativeTime(row.updated_at),
  }))
}

export async function createArticle(input: { title: string; category: string; body: string }, authorId: string): Promise<Article> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('articles')
    .insert({ title: input.title, category: input.category, body: input.body, author_id: authorId })
    .select('id,title,category,body,updated_at,author:employees!articles_author_id_fkey(name)')
    .single()
  if (error) throw error
  const row = data as any
  return { id: row.id, title: row.title, category: row.category, body: row.body, author: row.author?.name ?? 'ICT Administration', updatedAt: formatRelativeTime(row.updated_at) }
}

export async function updateArticle(id: string, input: { title: string; category: string; body: string }): Promise<Article> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('articles')
    .update({ title: input.title, category: input.category, body: input.body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id,title,category,body,updated_at,author:employees!articles_author_id_fkey(name)')
    .single()
  if (error) throw error
  const row = data as any
  return { id: row.id, title: row.title, category: row.category, body: row.body, author: row.author?.name ?? 'ICT Administration', updatedAt: formatRelativeTime(row.updated_at) }
}

// --- Service desk settings (single row, Administrator-editable) ---

export type ServiceDeskSettings = {
  responseTarget: string
  escalationEmail: string
}

export async function fetchSettings(): Promise<ServiceDeskSettings> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('service_desk_settings')
    .select('response_target,escalation_email')
    .eq('id', true)
    .single()
  if (error) throw error
  return { responseTarget: data.response_target, escalationEmail: data.escalation_email }
}

export async function updateSettings(input: ServiceDeskSettings): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('service_desk_settings')
    .update({ response_target: input.responseTarget, escalation_email: input.escalationEmail, updated_at: new Date().toISOString() })
    .eq('id', true)
  if (error) throw error
}

// --- Profile ---

export async function updateEmployeeProfile(id: string, name: string): Promise<Employee> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('employees')
    .update({ name })
    .eq('id', id)
    .select('id,name,email,department,role,status')
    .single()
  if (error) throw error
  return data as Employee
}