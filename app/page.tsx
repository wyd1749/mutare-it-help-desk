'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, ArrowLeft, ArrowRight, Bell, BookOpen, CheckCircle2, ChevronDown,
  ClipboardList, Clock3, Download, FileText, HelpCircle, LayoutDashboard, LogOut,
  Menu, MessageSquare, Plus, Search, Settings, ShieldCheck, Trash2, UserRound, Users, X,
} from 'lucide-react'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { subscribeToPush, type PushStatus } from '@/lib/push'
import { signIn, signOut, fetchCurrentEmployee, onAuthStateChange, createTeamMember } from '@/lib/supabase/auth'
import {
  fetchEmployees as dbFetchEmployees,
  fetchTickets as dbFetchTickets,
  fetchActivities as dbFetchActivities,
  createTicket as dbCreateTicket,
  updateTicket as dbUpdateTicket,
  deleteTicket as dbDeleteTicket,
  logActivity as dbLogActivity,
  fetchNotes as dbFetchNotes,
  createNote as dbCreateNote,
  fetchArticles as dbFetchArticles,
  createArticle as dbCreateArticle,
  updateArticle as dbUpdateArticle,
  deleteArticle as dbDeleteArticle,
  fetchSettings as dbFetchSettings,
  updateSettings as dbUpdateSettings,
  updateEmployeeProfile as dbUpdateEmployeeProfile,
  deleteEmployee as dbDeleteEmployee,
  type Note, type Article, type ServiceDeskSettings,
} from '@/lib/supabase/queries'

// How often the app quietly re-fetches tickets/activity so new requests,
// assignments and status changes show up without anyone reloading.
const POLL_INTERVAL_MS = 5000

// Time-of-day greeting based on the viewer's local clock:
// 00:00–11:59 → Good morning, 12:00–16:59 → Good afternoon, 17:00–23:59 → Good evening
function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// Supabase calls should never hang forever — a stuck request should surface
// as a real, retryable error instead of an endless spinner.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s. Check your connection and try again.`)),
        ms
      )
    ),
  ])
}

const crestUrl = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ChatGPT%20Image%20Sep%2010%2C%202026%2C%2005_59_02%20PM-fpjbEi391Jxs3WlrCYOJWR7EJ3F9LH.png'
type Role = 'employee' | 'admin' | 'technician' | 'senior_technician'
type Status = 'Open' | 'In progress' | 'Resolved'
type Priority = 'Critical' | 'High' | 'Medium' | 'Low'
type Ticket = { id: string; title: string; category: string; requester: string; department: string; doorNumber: string; time: string; priority: Priority; status: Status; assignee: string; description: string }
type Employee = { id: string; name: string; email: string; department: string; role: string; status: 'Active' | 'Invited' }
type Activity = { id: string; user: string; action: string; time: string }

const priorityClass: Record<Priority, string> = {
  Critical: 'bg-[#fff0ee] text-[#bd3c2d] border-[#f7c5bd]',
  High: 'bg-[#fff6e5] text-[#a76500] border-[#f2d39d]',
  Medium: 'bg-[#edf5ff] text-[#2563a8] border-[#c4dcf5]',
  Low: 'bg-[#eef8f1] text-[#27734a] border-[#c6e4d2]',
}

const statusClass: Record<Status, string> = {
  Open: 'bg-[#fff6e5] text-[#a76500]',
  'In progress': 'bg-[#edf5ff] text-[#2563a8]',
  Resolved: 'bg-[#eef8f1] text-[#27734a]',
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-2 ring-[#d9b44a]/50">
        <img src={crestUrl} alt="Mutare City Council crest" className="size-10 object-contain" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-[#d9b44a]">Mutare City Council</p>
          <p className="font-serif text-lg font-bold text-white">IT Service Desk</p>
        </div>
      )}
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
    } catch (err: any) {
      const msg = String(err?.message || '')
      setError(
        /invalid login credentials/i.test(msg)
          ? 'Email or password is incorrect. Check the details your administrator gave you.'
          : msg || 'Something went wrong. Please try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f7fa] text-[#183148]">
      <div className="grid min-h-screen lg:grid-cols-[minmax(390px,.9fr)_1.1fr]">
        <section className="relative hidden overflow-hidden bg-[#102f4a] px-12 py-10 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -left-32 -top-32 size-96 rounded-full border-[44px] border-white/5" />
          <div className="absolute -bottom-52 -right-28 size-[500px] rounded-full border-[58px] border-[#d9b44a]/10" />
          <Brand />
          <div className="relative max-w-md pb-8">
            <p className="mb-5 text-sm font-semibold uppercase tracking-[.22em] text-[#d9b44a]">Internal support portal</p>
            <h1 className="font-serif text-5xl font-bold leading-[1.07] text-white">Keeping Mutare connected.</h1>
            <p className="mt-6 max-w-sm text-base leading-7 text-blue-100/75">
              Report, track, assign, and resolve technology issues across the council.
            </p>
          </div>
          <p className="relative text-xs text-blue-100/45">For Mutare City Council employees only</p>
        </section>

        <section className="flex items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-[430px]">
            <div className="mb-9 flex items-center gap-3 lg:hidden">
              <Brand compact />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#2b6488]">Mutare City Council</p>
                <p className="font-serif text-lg font-bold text-[#183148]">IT Service Desk</p>
              </div>
            </div>
            <div className="mb-8">
              <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-[#e5f1f8] text-[#24769f]">
                <ShieldCheck />
              </div>
              <p className="mb-2 text-sm font-semibold uppercase tracking-[.18em] text-[#2b6488]">Welcome back</p>
              <h2 className="font-serif text-4xl font-bold tracking-tight">Sign in to get support</h2>
              <p className="mt-3 text-sm leading-6 text-[#648096]">Use the council email and password your administrator gave you.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
              className="rounded-2xl border border-[#dce7ed] bg-white p-6 shadow-[0_18px_45px_rgba(20,53,77,.08)]"
            >
              <label htmlFor="login-email" className="mb-2 block text-sm font-semibold">Council email</label>
              <input
                id="login-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@mutarecity.org"
                type="email"
                autoComplete="username"
                className="mb-5 h-12 w-full rounded-xl border border-[#dce7ed] bg-[#fbfdfe] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2f87b1]"
              />
              <label htmlFor="login-password" className="mb-2 block text-sm font-semibold">Password</label>
              <input
                id="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="********"
                autoComplete="current-password"
                className="h-12 w-full rounded-xl border border-[#dce7ed] bg-[#fbfdfe] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2f87b1]"
              />
              {error && <p className="mt-4 rounded-lg bg-[#fff0ee] px-3 py-2 text-xs font-semibold text-[#bd3c2d]">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#24769f] text-sm font-bold text-white shadow-[0_8px_18px_rgba(36,118,159,.25)] hover:bg-[#1c6388] disabled:opacity-60"
              >
                {submitting ? 'Please wait…' : 'Sign in to portal'} <ArrowRight size={16} />
              </button>
              <p className="mt-5 text-center text-xs leading-5 text-[#8a9ba7]">
                No account yet? Ask an ICT administrator to create one for you.
              </p>
            </form>
          </div>
        </section>
      </div>
    </main>
  )
}

function Sidebar({
  role,
  active,
  setActive,
  mobileOpen,
  setMobileOpen,
  openCount,
}: {
  role: Role
  active: string
  setActive: (x: string) => void
  mobileOpen: boolean
  setMobileOpen: (x: boolean) => void
  openCount: number
}) {
  const items =
    role === 'admin'
      ? [['Overview', LayoutDashboard], ['All requests', ClipboardList], ['Knowledge base', BookOpen], ['Team settings', Users], ['Reports', FileText]]
      : role === 'technician'
      ? [['My tasks', LayoutDashboard], ['Assigned requests', ClipboardList], ['Knowledge base', BookOpen], ['My profile', UserRound]]
      : role === 'senior_technician'
      ? [['Service desk monitor', LayoutDashboard]]
      : [['My overview', LayoutDashboard], ['My requests', ClipboardList], ['Help articles', BookOpen], ['My profile', UserRound]]

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-[#102f4a]/30 lg:hidden ${mobileOpen ? 'block' : 'hidden'}`}
        onClick={() => setMobileOpen(false)}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col bg-[#102f4a] px-5 py-6 transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-12 flex items-center justify-between">
          <Brand />
          <button onClick={() => setMobileOpen(false)} className="text-white/70 lg:hidden">
            <X />
          </button>
        </div>
        <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-blue-100/45">Workspace</p>
        <nav className="flex flex-col gap-1">
          {items.map(([label, Icon]) => (
            <button
              key={label as string}
              onClick={() => {
                setActive(label as string)
                setMobileOpen(false)
              }}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${
                active === label ? 'bg-white/12 text-white' : 'text-blue-100/65 hover:bg-white/8 hover:text-white'
              }`}
            >
              <Icon size={18} />
              {label as string}
              {label === 'All requests' && (
                <span className="ml-auto rounded-full bg-[#d9b44a] px-2 py-0.5 text-[10px] font-bold text-[#102f4a]">{openCount}</span>
              )}
            </button>
          ))}
        </nav>
        {role !== 'senior_technician' && (
          <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-[#d9b44a]/20 text-[#e6c65f]">
              <HelpCircle size={18} />
            </div>
            <p className="text-sm font-semibold text-white">Need a hand?</p>
            <p className="mt-1 text-xs leading-5 text-blue-100/55">Browse quick fixes and troubleshooting guides.</p>
            <button onClick={() => setActive('Knowledge base')} className="mt-3 text-xs font-bold text-[#e6c65f]">
              Browse articles <ArrowRight className="ml-1 inline" size={12} />
            </button>
          </div>
        )}
      </aside>
    </>
  )
}

function Header({
  user,
  setMobileOpen,
  onLogout,
  activities,
}: {
  user: Employee
  setMobileOpen: (x: boolean) => void
  onLogout: () => void
  activities: Activity[]
}) {
  const role =
    user.role === 'Administrator'
      ? 'admin'
      : user.role === 'Senior Technician'
      ? 'senior_technician'
      : user.role === 'Technician'
      ? 'technician'
      : 'employee'
  const label =
    role === 'admin'
      ? 'Administrator workspace'
      : role === 'senior_technician'
      ? 'Service desk monitor'
      : role === 'technician'
      ? 'Technician workspace'
      : 'Employee workspace'
  const name = user.name
  const sub = `${user.department} · ${user.email}`
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const initials = user.name.split(' ').filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?'

  return (
    <header className="flex h-[78px] items-center justify-between border-b border-[#e0e9ee] bg-white px-5 sm:px-8">
      <button onClick={() => setMobileOpen(true)} className="text-[#2b6488] lg:hidden">
        <Menu />
      </button>
      <div className="hidden lg:block">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#8aa0ae]">{label}</p>
        <p className="mt-1 text-sm font-semibold text-[#26465d]">{today}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() =>
            alert(
              activities.length
                ? activities.map((item) => `${item.user}: ${item.action}`).join('\n')
                : 'No recent activity.'
            )
          }
          className="relative flex size-10 items-center justify-center rounded-xl border border-[#e0e9ee] text-[#628094]"
        >
          <Bell size={18} />
          {activities.length > 0 && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-[#d9b44a]" />}
        </button>
        <div className="hidden h-8 w-px bg-[#e0e9ee] sm:block" />
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-full bg-[#e5f1f8] text-sm font-bold text-[#24769f]">
            {initials}
          </div>
          <div className="hidden sm:block">
            <p className="text-xs font-bold text-[#26465d]">{name}</p>
            <p className="text-[11px] text-[#8aa0ae]">{sub}</p>
          </div>
          <button onClick={onLogout} className="ml-2 text-[#8aa0ae] hover:text-[#bd3c2d]" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  )
}

function EmployeeOverview({
  onOpen,
  go,
  tickets,
  user,
}: {
  onOpen: (t: Ticket) => void
  go: (x: string) => void
  tickets: Ticket[]
  user: Employee
}) {
  const mine = tickets.filter((t) => t.requester === user.name)
  return (
    <Page
      title="How can we help today?"
      eyebrow={`${getGreeting()}, ${user.name.split(' ')[0]}`}
      sub="Report an IT issue and our team will get right on it."
      action={
        <button onClick={() => go('New request')} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#24769f] px-5 text-sm font-bold text-white">
          <Plus size={17} /> Report an issue
        </button>
      }
    >
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat dark label="Open requests" value={String(mine.filter((t) => t.status !== 'Resolved').length)} note="Currently being reviewed" />
        <Stat label="Resolved" value={String(mine.filter((t) => t.status === 'Resolved').length)} note="All time" />
        <Stat label="Average response" value="24m" note="Not yet tracked" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.35fr,.65fr]">
        <Card>
          <CardHead title="Your recent requests" link="View all" onClick={() => go('My requests')} />
          <div className="divide-y divide-[#edf1f3]">
            {mine.length ? (
              mine.map((t) => <TicketRow key={t.id} t={t} onClick={() => onOpen(t)} />)
            ) : (
              <Empty title="No requests yet" text="Your submitted issues will appear here." />
            )}
          </div>
        </Card>
        <Card>
          <CardHead title="Popular help" />
          <div className="flex flex-col gap-2">
            {['Reset your council password', 'Connect to council Wi-Fi', 'Set up Outlook on a new device'].map((x, i) => (
              <button key={x} onClick={() => go('Help articles')} className="flex items-center gap-3 rounded-xl p-3 text-left text-sm font-semibold text-[#31546b] hover:bg-[#f4f8fa]">
                <span className="flex size-8 items-center justify-center rounded-lg bg-[#eaf4f8] text-[#24769f]">{i + 1}</span>
                {x}
                <ArrowRight className="ml-auto" size={15} />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  )
}

function NewRequest({
  onBack,
  onSubmit,
}: {
  onBack: () => void
  onSubmit: (t: { title: string; category: string; doorNumber: string; priority: Priority; description: string }) => Promise<Ticket>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('Medium')
  const [category, setCategory] = useState('Network & connectivity')
  const [doorNumber, setDoorNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Ticket | null>(null)

  if (created)
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center px-5 py-20 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-[#eef8f1] text-[#27734a]">
          <CheckCircle2 size={32} />
        </div>
        <h1 className="mt-6 font-serif text-3xl font-bold">Request submitted</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-[#71899a]">
          Your issue has been logged as <strong>{created.id}</strong>. The ICT team will keep you updated.
        </p>
        <button onClick={onBack} className="mt-8 rounded-xl bg-[#24769f] px-5 py-3 text-sm font-bold text-white">
          Back to overview
        </button>
      </div>
    )

  const submit = async () => {
    if (!title || !description || !doorNumber) return
    setError('')
    setSubmitting(true)
    try {
      const ticket = await onSubmit({ title, category, doorNumber, priority, description })
      setCreated(ticket)
    } catch (err: any) {
      setError(err?.message || 'Could not submit your request. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-5 sm:p-8">
      <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm font-semibold text-[#24769f]">
        <ArrowLeft size={16} /> Back
      </button>
      <PageTitle eyebrow="New support request" title="Tell us what's going on" sub="Give us as much detail as possible so we can resolve your issue quickly." />
      <Card>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Issue title" full>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. I cannot connect to office Wi-Fi" className="input" />
          </Field>
          <Field label="Issue category">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              <option>Network & connectivity</option>
              <option>Email & communication</option>
              <option>Hardware & devices</option>
              <option>Access & security</option>
              <option>Software & applications</option>
              <option>Other IT issue</option>
            </select>
          </Field>
          <Field label="Urgency">
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="input">
              <option>Critical</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </Field>
          <Field label="Door number">
            <input value={doorNumber} onChange={(e) => setDoorNumber(e.target.value)} placeholder="e.g. Door 14, Room 203" className="input" />
          </Field>
          <Field label="Describe the issue" full>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="Tell us what happened, what you were trying to do, and any error message you saw."
              className="input min-h-32 resize-y"
            />
          </Field>
          <div className="sm:col-span-2 rounded-xl bg-[#f4f8fa] p-4 text-xs leading-5 text-[#648096]">
            <AlertCircle className="mr-2 inline text-[#24769f]" size={15} />
            Mark Critical only when work is fully blocked, there is a security concern, or a council-wide service is unavailable.
          </div>
        </div>
        {error && <p className="mt-4 rounded-lg bg-[#fff0ee] px-3 py-2 text-xs font-semibold text-[#bd3c2d]">{error}</p>}
        <button
          disabled={!title || !description || !doorNumber || submitting}
          onClick={submit}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#24769f] text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {submitting ? 'Submitting…' : 'Submit request'} <ArrowRight size={16} />
        </button>
      </Card>
    </div>
  )
}

type NewAdminTicketInput = {
  title: string
  category: string
  doorNumber: string
  priority: Priority
  description: string
  requesterId: string
  assigneeId?: string
}

function NewAdminTicket({
  onBack,
  onSubmit,
  employees,
  technicians,
  seniorTechnicians,
  admins,
}: {
  onBack: () => void
  onSubmit: (t: NewAdminTicketInput) => Promise<Ticket>
  employees: Employee[]
  technicians: Employee[]
  seniorTechnicians: Employee[]
  admins: Employee[]
}) {
  // Anyone in the council can be the requester on an admin-filed ticket —
  // not just employees. Group them so the dropdown stays readable.
  const requesterGroups: { label: string; people: Employee[] }[] = [
    { label: 'Employees', people: employees },
    { label: 'Technicians', people: technicians },
    { label: 'Senior technicians', people: seniorTechnicians },
    { label: 'Administrators', people: admins },
  ].filter((g) => g.people.length > 0)
  const allRequesters = [...employees, ...technicians, ...seniorTechnicians, ...admins]

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('Medium')
  const [category, setCategory] = useState('Network & connectivity')
  const [doorNumber, setDoorNumber] = useState('')
  const [requesterId, setRequesterId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Ticket | null>(null)

  if (created)
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center px-5 py-20 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-[#eef8f1] text-[#27734a]">
          <CheckCircle2 size={32} />
        </div>
        <h1 className="mt-6 font-serif text-3xl font-bold">Ticket created</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-[#71899a]">
          <strong>{created.id}</strong> has been logged for {created.requester}
          {created.assignee !== 'Unassigned' ? ` and assigned to ${created.assignee}` : ''}.
        </p>
        <div className="mt-8 flex gap-3">
          <button
            onClick={() => {
              setCreated(null)
              setTitle('')
              setDescription('')
              setPriority('Medium')
              setCategory('Network & connectivity')
              setDoorNumber('')
              setRequesterId('')
              setAssigneeId('')
            }}
            className="rounded-xl border border-[#dce7ed] bg-white px-5 py-3 text-sm font-bold text-[#31546b]"
          >
            Create another
          </button>
          <button onClick={onBack} className="rounded-xl bg-[#24769f] px-5 py-3 text-sm font-bold text-white">
            View in request list
          </button>
        </div>
      </div>
    )

  const submit = async () => {
    if (!title || !description || !requesterId) return
    setError('')
    setSubmitting(true)
    try {
      const ticket = await onSubmit({
        title,
        category,
        doorNumber,
        priority,
        description,
        requesterId,
        assigneeId: assigneeId || undefined,
      })
      setCreated(ticket)
    } catch (err: any) {
      setError(err?.message || 'Could not create the ticket. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-5 sm:p-8">
      <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm font-semibold text-[#24769f]">
        <ArrowLeft size={16} /> Back
      </button>
      <PageTitle eyebrow="Log a request" title="Create a ticket on someone's behalf" sub="Use this when an issue comes in by phone, email, or in person." />
      <Card>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Who is this for?" full>
            <select value={requesterId} onChange={(e) => setRequesterId(e.target.value)} className="input">
              <option value="">Select a person…</option>
              {requesterGroups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.department}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Issue title" full>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cannot connect to office Wi-Fi" className="input" />
          </Field>
          <Field label="Issue category">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              <option>Network & connectivity</option>
              <option>Email & communication</option>
              <option>Hardware & devices</option>
              <option>Access & security</option>
              <option>Software & applications</option>
              <option>Other IT issue</option>
            </select>
          </Field>
          <Field label="Urgency">
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="input">
              <option>Critical</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </Field>
          <Field label="Door number">
            <input value={doorNumber} onChange={(e) => setDoorNumber(e.target.value)} placeholder="e.g. Door 14, Room 203" className="input" />
          </Field>
          <Field label="Assign to (optional)" full>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="input">
              <option value="">Leave unassigned</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Describe the issue" full>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="What happened, what they were trying to do, and any error message they saw."
              className="input min-h-32 resize-y"
            />
          </Field>
        </div>
        {error && <p className="mt-4 rounded-lg bg-[#fff0ee] px-3 py-2 text-xs font-semibold text-[#bd3c2d]">{error}</p>}
        <button
          disabled={!title || !description || !requesterId || submitting}
          onClick={submit}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#24769f] text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {submitting ? 'Creating…' : 'Create ticket'} <ArrowRight size={16} />
        </button>
      </Card>
    </div>
  )
}

function RequestDetail({ ticket, onBack }: { ticket: Ticket; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-3xl p-5 sm:p-8">
      <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm font-semibold text-[#24769f]">
        <ArrowLeft size={16} /> Back to my requests
      </button>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-sm font-bold text-[#24769f]">
            {ticket.id} · {ticket.category}
          </p>
          <h1 className="font-serif text-3xl font-bold">{ticket.title}</h1>
          <p className="mt-2 text-sm text-[#71899a]">
            Reported {ticket.time} · {ticket.department}
            {ticket.doorNumber ? ` · ${ticket.doorNumber}` : ''}
          </p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${statusClass[ticket.status]}`}>{ticket.status}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr,.7fr]">
        <Card>
          <h2 className="font-serif text-lg font-bold">What you told us</h2>
          <p className="mt-4 rounded-xl bg-[#f7fafb] p-4 text-sm leading-7 text-[#526f80]">{ticket.description}</p>
        </Card>
        <Card>
          <h2 className="font-serif text-lg font-bold">Status</h2>
          <label className="mt-5 block text-sm font-semibold">Handled by</label>
          <p className="mt-2 text-sm font-semibold text-[#26465d]">{ticket.assignee === 'Unassigned' ? 'Not yet assigned' : ticket.assignee}</p>
          <div className={`mt-5 inline-flex rounded-full border px-3 py-1 text-xs font-bold ${priorityClass[ticket.priority]}`}>
            {ticket.priority} priority
          </div>
          <p className="mt-5 text-xs leading-5 text-[#8aa0ae]">This page refreshes automatically, so updates from the ICT team will appear here without reloading.</p>
        </Card>
      </div>
    </div>
  )
}

function EmployeeRequests({ tickets, onOpen, user }: { tickets: Ticket[]; onOpen: (t: Ticket) => void; user: Employee }) {
  return (
    <PageTitle eyebrow="Support history" title="My requests" sub="Track the progress of every issue you have reported.">
      <Card>
        <div className="divide-y divide-[#edf1f3]">
          {tickets
            .filter((t) => t.requester === user.name)
            .map((t) => (
              <TicketRow key={t.id} t={t} onClick={() => onOpen(t)} />
            ))}
        </div>
      </Card>
    </PageTitle>
  )
}

function HelpArticles({ articles }: { articles: Article[] }) {
  const [selected, setSelected] = useState<Article | null>(null)
  return (
    <PageTitle eyebrow="Self-service support" title="Help articles" sub="Quick answers for common IT issues.">
      {articles.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {articles.map((a) => (
            <button key={a.id} onClick={() => setSelected(a)} className="rounded-2xl border border-[#dce7ed] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="mb-4 flex items-center justify-between">
                <BookOpen className="text-[#24769f]" size={20} />
                <span className="rounded-full bg-[#edf5ff] px-2.5 py-1 text-[11px] font-bold text-[#2563a8]">{a.category}</span>
              </div>
              <h3 className="font-serif text-lg font-bold">{a.title}</h3>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#71899a]">{a.body}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[#24769f]">
                Read article <ArrowRight size={13} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Empty title="No articles yet" text="Check back soon — ICT is still publishing self-service guides." />
      )}
      {selected && (
        <div className="mt-5 rounded-2xl border border-[#bcd8e5] bg-[#f1f9fc] p-5 text-sm text-[#31546b]">
          <strong>{selected.title}</strong>
          <p className="mt-2 whitespace-pre-wrap leading-6">{selected.body}</p>
          <p className="mt-3 text-xs text-[#8aa0ae]">If these steps do not resolve the issue, submit a request and include what you tried.</p>
        </div>
      )}
    </PageTitle>
  )
}

function AdminWorkspace({
  tickets,
  onSaveTicket,
  onDeleteTicket,
  active,
  setActive,
  employees,
  technicians,
  seniorTechnicians,
  admins,
  onAddMember,
  onDeleteMember,
  user,
  articles,
  onCreateArticle,
  onUpdateArticle,
  onDeleteArticle,
  settings,
  onSaveSettings,
  onCreateTicket,
}: {
  tickets: Ticket[]
  onSaveTicket: (t: Ticket) => Promise<void>
  onDeleteTicket: (id: string) => Promise<void>
  active: string
  setActive: (x: string) => void
  employees: Employee[]
  technicians: Employee[]
  seniorTechnicians: Employee[]
  admins: Employee[]
  onAddMember: (m: NewMember) => Promise<void>
  onDeleteMember: (id: string) => Promise<void>
  user: Employee
  articles: Article[]
  onCreateArticle: (input: { title: string; category: string; body: string }) => Promise<void>
  onUpdateArticle: (id: string, input: { title: string; category: string; body: string }) => Promise<void>
  onDeleteArticle: (id: string) => Promise<void>
  settings: ServiceDeskSettings | null
  onSaveSettings: (s: ServiceDeskSettings) => Promise<void>
  onCreateTicket: (input: NewAdminTicketInput) => Promise<Ticket>
}) {
  if (active === 'New ticket') {
    return (
      <NewAdminTicket
        onBack={() => setActive('All requests')}
        onSubmit={onCreateTicket}
        employees={employees}
        technicians={technicians}
        seniorTechnicians={seniorTechnicians}
        admins={admins}
      />
    )
  }
  if (active === 'Knowledge base') {
    return <KnowledgeBase admin articles={articles} onCreate={onCreateArticle} onUpdate={onUpdateArticle} onDelete={onDeleteArticle} />
  }
  if (active === 'Team settings') {
    return (
      <TeamSettings
        employees={employees}
        technicians={technicians}
        seniorTechnicians={seniorTechnicians}
        admins={admins}
        onAddMember={onAddMember}
        onDeleteMember={onDeleteMember}
        settings={settings}
        onSaveSettings={onSaveSettings}
      />
    )
  }
  if (active === 'Reports') {
    return <Reports tickets={tickets} />
  }
  return <AdminQueue tickets={tickets} onSaveTicket={onSaveTicket} onDeleteTicket={onDeleteTicket} overview={active === 'Overview'} go={setActive} technicians={technicians} user={user} />
}



function AdminQueue({
  tickets,
  onSaveTicket,
  onDeleteTicket,
  overview,
  go,
  technicians,
  user,
}: {
  tickets: Ticket[]
  onSaveTicket: (t: Ticket) => Promise<void>
  onDeleteTicket: (id: string) => Promise<void>
  overview: boolean
  go: (x: string) => void
  technicians: Employee[]
  user: Employee
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (filter === 'All' || t.status === filter) &&
          `${t.id} ${t.title} ${t.requester} ${t.department}`.toLowerCase().includes(query.toLowerCase())
      ),
    [tickets, filter, query]
  )

  const selected = selectedId ? tickets.find((t) => t.id === selectedId) ?? null : null

  if (selected) {
    return (
      <TicketDetail
        ticket={selected}
        technicians={technicians}
        user={user}
        onBack={() => setSelectedId(null)}
        onSave={onSaveTicket}
        onDelete={async () => {
          await onDeleteTicket(selected.id)
          setSelectedId(null)
        }}
      />
    )
  }

  return (
    <Page
      title="Service desk overview"
      eyebrow={`${getGreeting()}, ${user.name.split(' ')[0]}`}
      sub="Review, assign, and resolve every request from one place."
      action={
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={() => go('New ticket')} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#24769f] px-5 text-sm font-bold text-white">
            <Plus size={17} /> New ticket
          </button>
          <button onClick={() => go('Reports')} className="flex h-11 items-center gap-2 rounded-xl border border-[#dce7ed] bg-white px-5 text-sm font-bold text-[#31546b]">
            <Download size={16} /> Export report
          </button>
        </div>
      }
    >
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat dark label="Open requests" value={String(tickets.filter((t) => t.status !== 'Resolved').length)} note={`${tickets.filter((t) => t.assignee === 'Unassigned').length} unassigned`} />
        <Stat label="High priority" value={String(tickets.filter((t) => t.priority === 'High' || t.priority === 'Critical').length)} note="Requires attention today" />
        <Stat label="Resolved" value={String(tickets.filter((t) => t.status === 'Resolved').length)} note="All time" />
        <Stat label="Technicians" value={String(technicians.length)} note="Available for assignment" />
      </div>
      <Card>
        <div className="flex flex-col gap-4 border-b border-[#edf1f3] p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-serif text-lg font-bold">All requests</h2>
            <p className="mt-1 text-xs text-[#8aa0ae]">{filtered.length} requests match your filters</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Search className="absolute left-3 top-3 text-[#8aa0ae]" size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search requests"
                className="h-10 w-full rounded-lg border border-[#dce7ed] pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[#8bc4dc] sm:w-56"
              />
            </div>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-10 rounded-lg border border-[#dce7ed] bg-white px-3 text-sm">
              <option>All</option>
              <option>Open</option>
              <option>In progress</option>
              <option>Resolved</option>
            </select>
          </div>
        </div>
        <div className="divide-y divide-[#edf1f3]">
          {filtered.map((t) => (
            <TicketRow key={t.id} t={t} admin onClick={() => setSelectedId(t.id)} />
          ))}
        </div>
      </Card>
    </Page>
  )
}

function TicketDetail({
  ticket,
  technicians,
  user,
  onBack,
  onSave,
  onDelete,
}: {
  ticket: Ticket
  technicians: Employee[]
  user: Employee
  onBack: () => void
  onSave: (t: Ticket) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [draft, setDraft] = useState(ticket)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const [noteText, setNoteText] = useState('')
  const [notePosting, setNotePosting] = useState(false)
  const [noteError, setNoteError] = useState('')

  // Only administrators may reassign tickets. Technicians and other users
  // see the current assignee as read-only text — never an editable control.
  const isAdmin = user.role === 'Administrator'

  useEffect(() => {
    let cancelled = false
    setNotesLoading(true)
    dbFetchNotes(ticket.id)
      .then((n) => {
        if (!cancelled) setNotes(n)
      })
      .catch((err) => console.error('Could not load notes.', err))
      .finally(() => {
        if (!cancelled) setNotesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticket.id])

  const save = async () => {
    setError('')
    setSaving(true)
    try {
      await onSave(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } catch (err: any) {
      setError(err?.message || 'Could not save your changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete || !confirm('Are you sure you want to delete this ticket? This action cannot be undone.')) return
    setError('')
    setDeleting(true)
    try {
      await onDelete()
    } catch (err: any) {
      setError(err?.message || 'Could not delete ticket. Please try again.')
      setDeleting(false)
    }
  }

  const addNote = async () => {
    setNoteError('')
    if (!noteText.trim()) return
    setNotePosting(true)
    try {
      const created = await dbCreateNote(ticket.id, user.id, noteText.trim())
      setNotes((prev) => [created, ...prev])
      setNoteText('')
    } catch (err: any) {
      setNoteError(err?.message || 'Could not save your note. Please try again.')
    } finally {
      setNotePosting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-5 sm:p-8">
      <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm font-semibold text-[#24769f]">
        <ArrowLeft size={16} /> Back to requests
      </button>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-sm font-bold text-[#24769f]">
            {draft.id} · {draft.category}
          </p>
          <h1 className="font-serif text-3xl font-bold">{draft.title}</h1>
          <p className="mt-2 text-sm text-[#71899a]">
            Submitted by {draft.requester} · {draft.department} · {draft.time}
          </p>
          {draft.doorNumber && (
            <p className="mt-1 text-sm font-bold text-[#24769f]">
              <ClipboardList className="mr-1.5 inline" size={14} /> {draft.doorNumber}
            </p>
          )}
        </div>
        <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${statusClass[draft.status]}`}>{draft.status}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr,.7fr]">
        <Card>
          <h2 className="font-serif text-lg font-bold">Issue details</h2>
          <p className="mt-4 rounded-xl bg-[#f7fafb] p-4 text-sm leading-7 text-[#526f80]">{draft.description}</p>
          <label className="mt-6 block text-sm font-semibold">Internal note</label>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add an update for the technician or requester..."
            className="input mt-2 min-h-28 resize-none"
          />
          {noteError && <p className="mt-2 text-xs font-semibold text-[#bd3c2d]">{noteError}</p>}
          <button
            disabled={notePosting || !noteText.trim()}
            onClick={addNote}
            className="mt-3 rounded-xl border border-[#dce7ed] bg-white px-4 py-2.5 text-sm font-bold text-[#31546b] disabled:opacity-60"
          >
            {notePosting ? 'Adding…' : 'Add note'}
          </button>
          <div className="mt-5 divide-y divide-[#edf1f3] border-t border-[#edf1f3]">
            {notesLoading ? (
              <p className="py-4 text-xs text-[#8aa0ae]">Loading notes…</p>
            ) : notes.length ? (
              notes.map((n) => (
                <div key={n.id} className="py-3">
                  <p className="text-sm leading-6 text-[#31546b]">{n.body}</p>
                  <p className="mt-1 text-xs text-[#8aa0ae]">
                    {n.author} · {n.time}
                  </p>
                </div>
              ))
            ) : (
              <p className="py-4 text-xs text-[#8aa0ae]">No internal notes yet.</p>
            )}
          </div>
        </Card>
        <Card>
          <h2 className="font-serif text-lg font-bold">Manage request</h2>
          <label className="mt-5 block text-sm font-semibold">Assign to technician</label>
          {isAdmin ? (
            <select
              value={draft.assignee}
              onChange={(e) => setDraft({ ...draft, assignee: e.target.value, status: e.target.value === 'Unassigned' ? 'Open' : 'In progress' })}
              className="input mt-2"
            >
              <option>Unassigned</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-2 rounded-xl border border-[#dce7ed] bg-[#f7fafb] px-4 py-2.5 text-sm font-semibold text-[#26465d]">
              {draft.assignee === 'Unassigned' ? 'Not yet assigned' : draft.assignee}
            </p>
          )}
          <label className="mt-5 block text-sm font-semibold">Status</label>
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })} className="input mt-2">
            <option>Open</option>
            <option>In progress</option>
            <option>Resolved</option>
          </select>
          <div className={`mt-5 inline-flex rounded-full border px-3 py-1 text-xs font-bold ${priorityClass[draft.priority]}`}>
            {draft.priority} priority
          </div>
          {error && <p className="mt-4 rounded-lg bg-[#fff0ee] px-3 py-2 text-xs font-semibold text-[#bd3c2d]">{error}</p>}
          <div className="mt-6 flex flex-col gap-2">
            <button
              disabled={saving || deleting}
              onClick={save}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#24769f] text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? 'Saving…' : saved ? 'Changes saved' : 'Save changes'} <CheckCircle2 size={16} />
            </button>
            {onDelete && (
              <button
                disabled={saving || deleting}
                onClick={handleDelete}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#f7c5bd] bg-[#fff0ee] text-sm font-bold text-[#bd3c2d] hover:bg-[#fde8e5] disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete ticket'} <Trash2 size={16} />
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function TechnicianWorkspace({
  tickets,
  onSaveTicket,
  active,
  setActive,
  technicians,
  user,
  articles,
  onSaveProfile,
}: {
  tickets: Ticket[]
  onSaveTicket: (t: Ticket) => Promise<void>
  active: string
  setActive: (x: string) => void
  technicians: Employee[]
  user: Employee
  articles: Article[]
  onSaveProfile: (name: string) => Promise<void>
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (active === 'Knowledge base') return <KnowledgeBase articles={articles} />
  if (active === 'My profile') return <Profile user={user} onSave={onSaveProfile} />
  const mine = tickets.filter((t) => t.assignee === user.name)
  const selected = selectedId ? tickets.find((t) => t.id === selectedId) ?? null : null
  if (selected) return <TicketDetail ticket={selected} technicians={technicians} user={user} onBack={() => setSelectedId(null)} onSave={onSaveTicket} />

  return (
    <Page
      title="My assigned tasks"
      eyebrow={`${getGreeting()}, ${user.name.split(' ')[0]}`}
      sub="Focus on the requests assigned to you and keep employees updated."
    >
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat dark label="Assigned to me" value={String(mine.length)} note="Keep moving" />
        <Stat label="In progress" value={String(mine.filter((t) => t.status === 'In progress').length)} note="Active work" />
        <Stat label="Resolved" value={String(mine.filter((t) => t.status === 'Resolved').length)} note="All time" />
      </div>
      <Card>
        <CardHead title="My task queue" />
        <div className="divide-y divide-[#edf1f3]">
          {mine.length ? (
            mine.map((t) => <TicketRow key={t.id} t={t} admin onClick={() => setSelectedId(t.id)} />)
          ) : (
            <Empty title="Nothing assigned yet" text="Tickets assigned to you will show up here." />
          )}
        </div>
      </Card>
    </Page>
  )
}

// Read-only monitor for the Senior Technician role: every currently-assigned
// issue, most recent first, with the technician handling it shown inline.
// The only action available is deleting a report — no reassignment, status
// changes, or other editing.
function SeniorTechnicianMonitor({
  tickets,
  onDeleteTicket,
}: {
  tickets: Ticket[]
  onDeleteTicket: (id: string) => Promise<void>
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [activeAlert, setActiveAlert] = useState<Ticket | null>(null)
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [pushStatus, setPushStatus] = useState<PushStatus | 'idle'>('idle')
  const knownIds = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifyPermission(Notification.permission)
      if (Notification.permission === 'granted') subscribeToPush().then(setPushStatus)
    }
  }, [])

  const enableDesktopNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    const result = await Notification.requestPermission()
    setNotifyPermission(result)
    if (result === 'granted') setPushStatus(await subscribeToPush())
  }

  // `tickets` already arrives newest-first (fetchTickets orders by
  // reported_at descending), so filtering preserves that recency order —
  // the most recently reported assigned issue is always first in the list.
  const assigned = tickets.filter((t) => t.assignee !== 'Unassigned')
  const technicianCount = new Set(assigned.map((t) => t.assignee)).size
  const assignedIds = assigned.map((t) => t.id).join(',')

  // Detect the newest assigned ticket the senior technician hasn't seen yet.
  // Only ever announce that one ticket — not the whole board — and don't
  // announce anything already on the board when this monitor first loads.
  useEffect(() => {
    const currentIds = new Set(assigned.map((t) => t.id))
    if (knownIds.current === null) {
      knownIds.current = currentIds
      return
    }
    const newOnes = assigned.filter((t) => !knownIds.current!.has(t.id))
    if (newOnes.length) {
      // `assigned` is newest-first, so the first entry is the most recent.
      const newest = newOnes[0]
      setActiveAlert(newest)
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        const location = [newest.doorNumber, newest.department].filter(Boolean).join(' · ')
        // Fired a beat after setActiveAlert rather than in the same tick —
        // creating a Notification right as speech starts can leave some
        // browsers (Chrome/Edge) with speechSynthesis stuck "paused".
        setTimeout(() => {
          new Notification('Check the IT service monitor', {
            body: `New issue assigned${location ? ` — ${location}` : ''}: ${newest.title}`,
            tag: newest.id,
          })
        }, 300)
      }
    } else {
      setActiveAlert((prev) => (prev && !currentIds.has(prev.id) ? null : prev))
    }
    knownIds.current = currentIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedIds])

  // Speak the active alert on a loop until the senior technician stops it
  // (or it's removed because the ticket was deleted/unassigned).
  useEffect(() => {
    if (!activeAlert) return
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    let cancelled = false
    const location = [activeAlert.doorNumber, activeAlert.department].filter(Boolean).join(', ')
    const speakNext = () => {
      if (cancelled) return
      // Chrome/Edge can leave the speech queue stuck "paused" after a
      // notification, an alert(), or a tab focus change — reset it before
      // every utterance instead of trusting it's in a clean state.
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(
        `New issue. Assigned technician, please attend the issue. ${location}.`
      )
      utterance.rate = 0.95
      const scheduleNext = () => {
        if (cancelled) return
        setTimeout(speakNext, 2500)
      }
      utterance.onend = scheduleNext
      utterance.onerror = scheduleNext
      window.speechSynthesis.speak(utterance)
    }
    speakNext()
    // Some browsers silently pause a long-lived speech queue after ~15s;
    // nudging resume() periodically is the standard workaround.
    const watchdog = setInterval(() => {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume()
    }, 4000)
    return () => {
      cancelled = true
      clearInterval(watchdog)
      window.speechSynthesis.cancel()
    }
  }, [activeAlert])

  const stopAlert = () => setActiveAlert(null)

  const handleDelete = async (id: string) => {
    setError('')
    if (!confirm('Delete this report? This action cannot be undone.')) return
    setDeletingId(id)
    try {
      await onDeleteTicket(id)
    } catch (err: any) {
      setError(err?.message || 'Could not delete this report. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Page
      title="Service desk monitor"
      eyebrow="Senior technician"
      sub="A live view of every assigned issue, most recent first."
      action={
        notifyPermission === 'default' ? (
          <button
            onClick={enableDesktopNotifications}
            className="rounded-lg border border-[#dbe6ec] bg-white px-3 py-1.5 text-xs font-bold text-[#2b3a44] hover:bg-[#f4f8fa]"
          >
            <Bell className="mr-1.5 inline" size={13} /> Enable desktop notifications
          </button>
        ) : notifyPermission === 'denied' ? (
          <p className="text-xs text-[#8aa0ae]">Desktop notifications blocked — allow them in the browser's site settings.</p>
        ) : pushStatus === 'subscribed' ? (
          <p className="text-xs text-[#8aa0ae]">Background alerts on</p>
        ) : pushStatus === 'failed' ? (
          <p className="text-xs text-[#bd3c2d]">Background alerts couldn't be turned on</p>
        ) : undefined
      }
    >
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat dark label="Assigned issues" value={String(assigned.length)} note="Currently in a technician's queue" />
        <Stat label="Technicians with work" value={String(technicianCount)} note="Actively assigned" />
        <Stat label="Resolved" value={String(assigned.filter((t) => t.status === 'Resolved').length)} note="Among assigned issues" />
      </div>
      {activeAlert && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f7c5bd] bg-[#fff0ee] p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-bold text-[#bd3c2d]">
              <Bell className="animate-pulse" size={16} /> New issue announcing
            </p>
            <p className="mt-1 truncate text-sm font-bold">{activeAlert.title}</p>
            <p className="text-xs text-[#8aa0ae]">
              {[activeAlert.doorNumber, activeAlert.department].filter(Boolean).join(' · ')} · {activeAlert.assignee}
            </p>
          </div>
          <button
            onClick={stopAlert}
            className="shrink-0 rounded-lg border border-[#f7c5bd] bg-white px-3 py-1.5 text-xs font-bold text-[#bd3c2d] hover:bg-[#fde8e5]"
          >
            Stop
          </button>
        </div>
      )}
      {error && <p className="mb-4 rounded-lg bg-[#fff0ee] px-3 py-2 text-sm font-semibold text-[#bd3c2d]">{error}</p>}
      <Card>
        <CardHead title="All assigned issues" />
        {assigned.length ? (
          <div className="divide-y divide-[#edf1f3]">
            {assigned.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{t.title}</p>
                  <p className="mt-0.5 text-xs text-[#8aa0ae]">
                    {t.id} · {t.category} · {t.department} {t.doorNumber && `· ${t.doorNumber}`} · {t.time}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#edf5ff] px-2.5 py-1 text-[11px] font-bold text-[#2563a8]">{t.assignee}</span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClass[t.status]}`}>{t.status}</span>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${priorityClass[t.priority]}`}>{t.priority}</span>
                <button
                  disabled={deletingId === t.id}
                  onClick={() => handleDelete(t.id)}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#f7c5bd] bg-[#fff0ee] px-3 py-2 text-xs font-bold text-[#bd3c2d] hover:bg-[#fde8e5] disabled:opacity-60"
                >
                  <Trash2 size={14} /> {deletingId === t.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No assigned issues yet" text="Once a technician is assigned a ticket, it will show up here." />
        )}
      </Card>

    </Page>
  )
}

function KnowledgeBase({
  admin = false,
  articles,
  onCreate,
  onUpdate,
  onDelete,
}: {
  admin?: boolean
  articles: Article[]
  onCreate?: (input: { title: string; category: string; body: string }) => Promise<void>
  onUpdate?: (id: string, input: { title: string; category: string; body: string }) => Promise<void>
  onDelete?: (id: string) => Promise<void>
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState({ title: '', category: 'General', body: '' })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [formError, setFormError] = useState('')
  const [reading, setReading] = useState<Article | null>(null)

  const startNew = () => {
    setEditingId('new')
    setForm({ title: '', category: 'General', body: '' })
    setFormError('')
  }

  const startEdit = (a: Article) => {
    setEditingId(a.id)
    setForm({ title: a.title, category: a.category, body: a.body })
    setFormError('')
  }

  const handleDelete = async (id: string) => {
    if (!onDelete || !confirm('Are you sure you want to delete this article?')) return
    setDeletingId(id)
    try {
      await onDelete(id)
    } catch (err: any) {
      alert(err?.message || 'Could not delete article.')
    } finally {
      setDeletingId(null)
    }
  }

  const publish = async () => {
    setFormError('')
    if (!form.title.trim() || !form.body.trim()) {
      setFormError('Add a title and some content.')
      return
    }
    setSaving(true)
    try {
      if (editingId === 'new') await onCreate?.({ title: form.title.trim(), category: form.category, body: form.body.trim() })
      else if (editingId) await onUpdate?.(editingId, { title: form.title.trim(), category: form.category, body: form.body.trim() })
      setEditingId(null)
    } catch (err: any) {
      setFormError(err?.message || 'Could not save this article. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page
      title={admin ? 'Knowledge base management' : 'Knowledge base'}
      eyebrow={admin ? 'Content administration' : 'Self-service support'}
      sub={admin ? 'Publish clear solutions for employees and technicians.' : 'Quick answers for common IT issues.'}
      action={
        admin ? (
          <button onClick={startNew} className="flex h-11 items-center gap-2 rounded-xl bg-[#24769f] px-5 text-sm font-bold text-white">
            <Plus size={16} /> New article
          </button>
        ) : undefined
      }
    >
      <Card>
        <div className="divide-y divide-[#edf1f3]">
          {articles.length ? (
            articles.map((a) => (
              <div key={a.id} className="flex items-center gap-4 py-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-[#eaf4f8] text-[#24769f]">
                  <BookOpen size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{a.title}</p>
                  <p className="mt-1 text-xs text-[#8aa0ae]">
                    {a.category} · Updated {a.updatedAt}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => (admin ? startEdit(a) : setReading(a))} className="rounded-lg border border-[#dce7ed] px-3 py-2 text-xs font-bold text-[#31546b]">
                    {admin ? 'Edit' : 'Read'}
                  </button>
                  {admin && onDelete && (
                    <button
                      disabled={deletingId === a.id}
                      onClick={() => handleDelete(a.id)}
                      className="rounded-lg border border-[#f7c5bd] bg-[#fff0ee] p-2 text-xs font-bold text-[#bd3c2d] hover:bg-[#fde8e5] disabled:opacity-60"
                      title="Delete article"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <Empty title="No articles yet" text={admin ? 'Publish your first article to help employees self-serve.' : 'Check back soon for self-service guides.'} />
          )}
        </div>
        {reading && (
          <div className="mt-5 rounded-xl border border-[#bcd8e5] bg-[#f1f9fc] p-5 text-sm text-[#31546b]">
            <div className="flex items-start justify-between gap-3">
              <strong>{reading.title}</strong>
              <button onClick={() => setReading(null)} className="text-xs font-bold text-[#24769f]">
                Close
              </button>
            </div>
            <p className="mt-3 whitespace-pre-wrap leading-6">{reading.body}</p>
          </div>
        )}
        {editingId && (
          <div className="mt-5 rounded-xl bg-[#f4f8fa] p-4">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Article title" className="input" />
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input mt-3">
              <option>General</option>
              <option>Account & access</option>
              <option>Network & connectivity</option>
              <option>Email & communication</option>
              <option>Hardware & devices</option>
            </select>
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Article content" className="input mt-3 min-h-24 resize-none" />
            {formError && <p className="mt-2 text-xs font-semibold text-[#bd3c2d]">{formError}</p>}
            <div className="mt-3 flex gap-3">
              <button disabled={saving} onClick={publish} className="rounded-lg bg-[#24769f] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                {saving ? 'Saving…' : editingId === 'new' ? 'Publish article' : 'Save changes'}
              </button>
              <button onClick={() => setEditingId(null)} className="rounded-lg border border-[#dce7ed] px-4 py-2 text-sm font-bold text-[#31546b]">
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>
    </Page>
  )
}

type NewMember = { name: string; email: string; department: string; role: 'Employee' | 'Technician' | 'Administrator' | 'Senior Technician'; password: string }
const emptyMember: NewMember = { name: '', email: '', department: 'Finance', role: 'Employee', password: '' }
const generatePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const a = new Uint32Array(12)
  crypto.getRandomValues(a)
  return Array.from(a, (n) => chars[n % chars.length]).join('')
}

function PeopleList({
  title,
  note,
  people,
  onDeleteMember,
}: {
  title: string
  note: string
  people: Employee[]
  onDeleteMember?: (id: string) => Promise<void>
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (id: string, name: string) => {
    if (!onDeleteMember || !confirm(`Are you sure you want to delete the account for ${name}?`)) return
    setDeletingId(id)
    try {
      await onDeleteMember(id)
    } catch (err: any) {
      alert(err?.message || 'Could not delete member.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <div className="mt-8 mb-4">
        <h2 className="font-serif text-xl font-bold">{title}</h2>
        <p className="mt-1 text-sm text-[#71899a]">{note}</p>
      </div>
      <Card>
        <div className="divide-y divide-[#edf1f3]">
          {people.length ? (
            people.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-[#26465d]">{p.name}</p>
                  <p className="text-xs text-[#8aa0ae]">
                    {p.email} · {p.department}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${p.status === 'Active' ? 'bg-[#eef8f1] text-[#27734a]' : 'bg-[#fff6e5] text-[#a76500]'}`}>
                    {p.status}
                  </span>
                  {onDeleteMember && (
                    <button
                      disabled={deletingId === p.id}
                      onClick={() => handleDelete(p.id, p.name)}
                      className="rounded-lg border border-[#f7c5bd] bg-[#fff0ee] p-1.5 text-xs font-bold text-[#bd3c2d] hover:bg-[#fde8e5] disabled:opacity-60"
                      title="Delete account"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <Empty title="No one here yet" text="Add a team member to see them listed." />
          )}
        </div>
      </Card>
    </>
  )
}

function TeamSettings({
  employees,
  technicians,
  seniorTechnicians,
  admins,
  onAddMember,
  onDeleteMember,
  settings,
  onSaveSettings,
}: {
  employees: Employee[]
  technicians: Employee[]
  seniorTechnicians: Employee[]
  admins: Employee[]
  onAddMember: (m: NewMember) => Promise<void>
  onDeleteMember: (id: string) => Promise<void>
  settings: ServiceDeskSettings | null
  onSaveSettings: (s: ServiceDeskSettings) => Promise<void>
}) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<NewMember>(emptyMember)
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')
  const [createdMsg, setCreatedMsg] = useState('')
  const [prefs, setPrefs] = useState<ServiceDeskSettings>({ responseTarget: '4 business hours', escalationEmail: '' })
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsSaved, setPrefsSaved] = useState(false)
  const [prefsError, setPrefsError] = useState('')

  useEffect(() => {
    if (settings) setPrefs(settings)
  }, [settings])

  const setRole = (role: NewMember['role']) => setForm({ ...form, role, department: role === 'Employee' ? (form.department === 'ICT' ? 'Finance' : form.department) : 'ICT' })

  const create = async () => {
    setFormError('')
    setCreatedMsg('')
    const email = form.email.trim().toLowerCase()
    if (!form.name.trim() || !email || !form.password) {
      setFormError('Fill in the name, email and temporary password.')
      return
    }
    if (!email.endsWith('@mutarecity.org')) {
      setFormError('Email must end with @mutarecity.org.')
      return
    }
    if (form.password.length < 8) {
      setFormError('Temporary password must be at least 8 characters.')
      return
    }
    setCreating(true)
    try {
      await onAddMember({ ...form, name: form.name.trim(), email })
      setCreatedMsg(`Account created for ${form.name.trim()}. Give them ${email} and the temporary password so they can sign in.`)
      setForm(emptyMember)
      setShowForm(false)
    } catch (err: any) {
      setFormError(err?.message || 'Could not create the account.')
    } finally {
      setCreating(false)
    }
  }

  const savePrefs = async () => {
    setPrefsError('')
    setPrefsSaving(true)
    try {
      await onSaveSettings(prefs)
      setPrefsSaved(true)
      setTimeout(() => setPrefsSaved(false), 2200)
    } catch (err: any) {
      setPrefsError(err?.message || 'Could not save these preferences. Please try again.')
    } finally {
      setPrefsSaving(false)
    }
  }

  return (
    <Page title="Team settings" eyebrow="Administration" sub="Create accounts for employees, technicians, senior technicians and administrators, and manage service desk preferences.">
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-serif text-xl font-bold">Team accounts</h2>
          <p className="mt-1 text-sm text-[#71899a]">
            Each person signs in with the email and temporary password you set here. Their role decides which workspace they see.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(!showForm)
            setFormError('')
          }}
          className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#24769f] px-4 text-sm font-bold text-white"
        >
          <Plus size={16} /> Add team member
        </button>
      </div>
      {createdMsg && <p className="mb-4 rounded-lg bg-[#eef8f1] px-3 py-2 text-sm font-semibold text-[#27734a]">{createdMsg}</p>}
      {showForm && (
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nyasha Ncube" className="input" />
            </Field>
            <Field label="Council email">
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@mutarecity.org" type="email" className="input" />
            </Field>
            <Field label="Role">
              <select value={form.role} onChange={(e) => setRole(e.target.value as NewMember['role'])} className="input">
                <option>Employee</option>
                <option>Technician</option>
                <option>Senior Technician</option>
                <option>Administrator</option>
              </select>
            </Field>
            <Field label="Department">
              <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="input">
                <option>Finance</option>
                <option>Human Resources</option>
                <option>Engineering</option>
                <option>Legal Services</option>
                <option>Registry</option>
                <option>ICT</option>
                <option>Other</option>
              </select>
            </Field>
            <Field label="Temporary password" full>
              <div className="flex gap-2">
                <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" className="input" />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, password: generatePassword() })}
                  className="shrink-0 rounded-xl border border-[#dce7ed] px-4 text-sm font-bold text-[#31546b]"
                >
                  Generate
                </button>
              </div>
            </Field>
          </div>
          {formError && <p className="mt-4 rounded-lg bg-[#fff0ee] px-3 py-2 text-xs font-semibold text-[#bd3c2d]">{formError}</p>}
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              onClick={() => {
                setShowForm(false)
                setFormError('')
              }}
              className="rounded-xl border border-[#dce7ed] px-4 py-2 text-sm font-bold text-[#31546b]"
            >
              Cancel
            </button>
            <button disabled={creating} onClick={create} className="rounded-xl bg-[#24769f] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {creating ? 'Creating…' : 'Create account'}
            </button>
          </div>
        </Card>
      )}
      <PeopleList title="Administrators" note="Full access to every request, report and account." people={admins} onDeleteMember={onDeleteMember} />
      <PeopleList
        title="Senior technicians"
        note="Read-only monitor of every assigned issue, with the ability to delete reports."
        people={seniorTechnicians}
        onDeleteMember={onDeleteMember}
      />
      <PeopleList title="Employees" note="Can report issues and track their own requests." people={employees} onDeleteMember={onDeleteMember} />
      <PeopleList title="Technicians" note="Available for ticket assignment." people={technicians} onDeleteMember={onDeleteMember} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHead title="ICT team" />
          <div className="divide-y divide-[#edf1f3]">
            {technicians.map((t, i) => (
              <div key={t.id} className="flex items-center gap-3 py-4">
                <div className="flex size-10 items-center justify-center rounded-full bg-[#e5f1f8] text-sm font-bold text-[#24769f]">
                  {t.name
                    .split(' ')
                    .map((x) => x[0])
                    .join('')}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold">{t.name}</p>
                  <p className="text-xs text-[#8aa0ae]">{i === 0 ? 'Network & hardware' : 'Applications & access'}</p>
                </div>
                <span className="rounded-full bg-[#eef8f1] px-2.5 py-1 text-[11px] font-bold text-[#27734a]">{t.status}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Service desk preferences" />
          <label className="mb-2 mt-2 block text-sm font-semibold">Default response target</label>
          <select value={prefs.responseTarget} onChange={(e) => setPrefs({ ...prefs, responseTarget: e.target.value })} className="input">
            <option>4 business hours</option>
            <option>1 business day</option>
            <option>Same day</option>
          </select>
          <label className="mb-2 mt-5 block text-sm font-semibold">Escalation email</label>
          <input value={prefs.escalationEmail} onChange={(e) => setPrefs({ ...prefs, escalationEmail: e.target.value })} className="input" />
          {prefsError && <p className="mt-3 text-xs font-semibold text-[#bd3c2d]">{prefsError}</p>}
          <button disabled={prefsSaving} onClick={savePrefs} className="mt-5 rounded-xl bg-[#24769f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
            {prefsSaving ? 'Saving…' : 'Save settings'}
          </button>
          {prefsSaved && <p className="mt-3 text-xs font-semibold text-[#27734a]">Settings saved successfully.</p>}
        </Card>
      </div>
    </Page>
  )
}

function Reports({ tickets }: { tickets: Ticket[] }) {
  const resolved = tickets.filter((t) => t.status === 'Resolved').length
  const resolutionRate = tickets.length ? `${Math.round((resolved / tickets.length) * 100)}%` : '—'

  const exportCsv = () => {
    const csv = [
      'ID,Title,Category,Requester,Department,Priority,Status,Assignee',
      ...tickets.map((t) =>
        [t.id, t.title, t.category, t.requester, t.department, t.priority, t.status, t.assignee]
          .map((v) => `"${v.replaceAll('"', '""')}"`)
          .join(',')
      ),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'mutare-it-service-report.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Page
      title="Reports & exports"
      eyebrow="Administrator workspace"
      sub="Review service performance and download request data."
      action={
        <button onClick={exportCsv} className="flex h-11 items-center gap-2 rounded-xl bg-[#24769f] px-5 text-sm font-bold text-white">
          <Download size={16} /> Download CSV
        </button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat dark label="Total requests" value={String(tickets.length)} note="This reporting period" />
        <Stat label="Resolution rate" value={resolutionRate} note={`${resolved} of ${tickets.length} resolved`} />
        <Stat label="Avg. response" value="24m" note="Not yet tracked" />
      </div>
      <Card>
        <CardHead title="Request report preview" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-[#8aa0ae]">
              <tr>
                <th className="pb-3">Request</th>
                <th className="pb-3">Priority</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Technician</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-t border-[#edf1f3]">
                  <td className="py-3">
                    <strong>{t.id}</strong>
                    <p className="text-xs text-[#71899a]">{t.title}</p>
                  </td>
                  <td className="py-3">
                    <span className={`rounded-full border px-2 py-1 text-xs font-bold ${priorityClass[t.priority]}`}>{t.priority}</span>
                  </td>
                  <td className="py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusClass[t.status]}`}>{t.status}</span>
                  </td>
                  <td className="py-3 text-[#526f80]">{t.assignee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  )
}

function Profile({ user, onSave }: { user: Employee; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(user.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setName(user.name)
  }, [user.id, user.name])

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const save = async () => {
    setError('')
    if (!name.trim()) {
      setError('Name cannot be empty.')
      return
    }
    setSaving(true)
    try {
      await onSave(name.trim())
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } catch (err: any) {
      setError(err?.message || 'Could not save your profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page title="My profile" eyebrow="Account settings" sub="Your council service desk profile.">
      <Card>
        <div className="flex items-center gap-4 border-b border-[#edf1f3] pb-5">
          <div className="flex size-14 items-center justify-center rounded-full bg-[#e5f1f8] text-lg font-bold text-[#24769f]">{initials}</div>
          <div>
            <h2 className="font-serif text-xl font-bold">{user.name}</h2>
            <p className="text-sm text-[#71899a]">
              {user.role} · {user.department}
            </p>
          </div>
        </div>
        <div className="grid gap-5 pt-5 sm:grid-cols-2">
          <Field label="Full name">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </Field>
          <Field label="Council email">
            <input value={user.email} disabled className="input opacity-60" />
          </Field>
        </div>
        <p className="mt-2 text-xs text-[#8aa0ae]">Email changes go through your administrator, since it's how you sign in.</p>
        {error && <p className="mt-4 rounded-lg bg-[#fff0ee] px-3 py-2 text-xs font-semibold text-[#bd3c2d]">{error}</p>}
        <button disabled={saving} onClick={save} className="mt-6 rounded-xl bg-[#24769f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
        </button>
      </Card>
    </Page>
  )
}

function Page({ title, eyebrow, sub, action, children }: { title: string; eyebrow: string; sub: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl p-5 sm:p-8">
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <PageTitle eyebrow={eyebrow} title={title} sub={sub} />
        {action}
      </div>
      {children}
    </div>
  )
}

function PageTitle({ eyebrow, title, sub, children }: { eyebrow: string; title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-sm font-semibold text-[#24769f]">{eyebrow}</p>
      <h1 className="font-serif text-3xl font-bold tracking-tight text-[#183148] sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-[#71899a]">{sub}</p>
      {children}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[#dce7ed] bg-white p-5 shadow-sm sm:p-6">{children}</section>
}

function CardHead({ title, link, onClick }: { title: string; link?: string; onClick?: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-serif text-lg font-bold text-[#183148]">{title}</h2>
      {link && (
        <button onClick={onClick} className="text-xs font-bold text-[#24769f]">
          {link} <ArrowRight className="ml-1 inline" size={12} />
        </button>
      )}
    </div>
  )
}

function Stat({ label, value, note, dark = false }: { label: string; value: string; note: string; dark?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 ${dark ? 'bg-[#102f4a] text-white' : 'border border-[#dce7ed] bg-white'}`}>
      <p className={`text-xs font-semibold uppercase tracking-wider ${dark ? 'text-blue-100/60' : 'text-[#8aa0ae]'}`}>{label}</p>
      <p className="mt-3 text-3xl font-bold">{value}</p>
      <p className={`mt-1 text-xs ${dark ? 'text-blue-100/60' : 'text-[#71899a]'}`}>{note}</p>
    </div>
  )
}

function TicketRow({ t, onClick, admin = false }: { t: Ticket; onClick: () => void; admin?: boolean }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-1 py-4 text-left hover:bg-[#f8fbfc] sm:gap-4">
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${t.priority === 'Critical' || t.priority === 'High' ? 'bg-[#fff6e5] text-[#a76500]' : 'bg-[#eaf4f8] text-[#24769f]'}`}>
        <ClipboardList size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[#31546b]">{t.title}</p>
        <p className="mt-1 text-xs text-[#8aa0ae]">
          {t.id} · {t.category} {t.doorNumber && `· ${t.doorNumber}`} {admin && `· ${t.requester}`}
        </p>
      </div>
      <div className="hidden text-right sm:block">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClass[t.status]}`}>{t.status}</span>
        <p className="mt-1 text-[11px] text-[#8aa0ae]">{t.time}</p>
      </div>
      <ArrowRight size={16} className="shrink-0 text-[#9db1bd]" />
    </button>
  )
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="py-10 text-center">
      <Clock3 className="mx-auto text-[#9db1bd]" />
      <p className="mt-3 text-sm font-bold">{title}</p>
      <p className="mt-1 text-xs text-[#8aa0ae]">{text}</p>
    </div>
  )
}

function Field({ label, full = false, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`${full ? 'sm:col-span-2' : ''} block`}>
      <span className="mb-2 block text-sm font-semibold text-[#26465d]">{label}</span>
      {children}
    </label>
  )
}

export default function PageRoot() {
  const [user, setUser] = useState<Employee | null>(null)
  const [active, setActive] = useState('')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [technicianUsers, setTechnicianUsers] = useState<Employee[]>([])
  const [seniorTechnicians, setSeniorTechnicians] = useState<Employee[]>([])
  const [admins, setAdmins] = useState<Employee[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [settings, setSettings] = useState<ServiceDeskSettings | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profileMissing, setProfileMissing] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const role =
    user?.role === 'Administrator'
      ? 'admin'
      : user?.role === 'Senior Technician'
      ? 'senior_technician'
      : user?.role === 'Technician'
      ? 'technician'
      : 'employee'
  const [mobileOpen, setMobileOpen] = useState(false)
  const loggedInRef = useRef<string | null>(null)

  const activeTabSetForUserId = useRef<string | null>(null)
  const dataLoadedForUserId = useRef<string | null>(null)

  const userIdRef = useRef(user?.id)
  useEffect(() => {
    userIdRef.current = user?.id
  }, [user?.id])

  // Watch Supabase Auth session
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoadError('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local and restart the dev server.')
      setAuthChecking(false)
      return
    }
    let cancelled = false
    const loadProfile = async () => {
      try {
        const profile = await withTimeout(fetchCurrentEmployee(), 10000, 'Loading your account')
        if (cancelled) return
        if (!profile) {
          setProfileMissing(true)
          setUser(null)
          activeTabSetForUserId.current = null
        } else {
          setProfileMissing(false)
          setUser(profile)
          if (activeTabSetForUserId.current !== profile.id) {
            activeTabSetForUserId.current = profile.id
            setActive(
              profile.role === 'Administrator'
                ? 'Overview'
                : profile.role === 'Senior Technician'
                ? 'Service desk monitor'
                : profile.role === 'Technician'
                ? 'My tasks'
                : 'My overview'
            )
          }
        }
      } catch (err) {
        console.error('Could not load your profile.', err)
        if (!cancelled) setLoadError('Could not verify your account. Please refresh and try signing in again.')
      } finally {
        if (!cancelled) setAuthChecking(false)
      }
    }

    const unsubscribe = onAuthStateChange((event, hasSession) => {
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return
      if (hasSession) {
        loadProfile()
      } else {
        // Clear all state on sign out
        setUser(null)
        setProfileMissing(false)
        setAuthChecking(false)
        activeTabSetForUserId.current = null
        dataLoadedForUserId.current = null
        setTickets([])
        setEmployees([])
        setTechnicianUsers([])
        setSeniorTechnicians([])
        setAdmins([])
        setActivities([])
        setArticles([])
        setSettings(null)
        setSelectedTicketId(null)
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // Load service desk data once signed in
  useEffect(() => {
    if (!user) return
    if (dataLoadedForUserId.current === user.id) return
    dataLoadedForUserId.current = user.id
    let cancelled = false
    setDataLoading(true)
    ;(async () => {
      try {
        const [people, dbTickets, dbActivities, dbArticles, dbSettings] = await Promise.all([
          withTimeout(dbFetchEmployees(), 10000, 'Loading employees'),
          withTimeout(dbFetchTickets(), 10000, 'Loading tickets'),
          withTimeout(dbFetchActivities(), 10000, 'Loading activity'),
          withTimeout(dbFetchArticles(), 10000, 'Loading articles'),
          withTimeout(dbFetchSettings(), 10000, 'Loading settings'),
        ])
        if (cancelled) return
        setEmployees(people.filter((p) => p.role === 'Employee'))
        setTechnicianUsers(people.filter((p) => p.role === 'Technician'))
        setSeniorTechnicians(people.filter((p) => p.role === 'Senior Technician'))
        setAdmins(people.filter((p) => p.role === 'Administrator'))
        setTickets(dbTickets)
        setActivities(dbActivities)
        setArticles(dbArticles)
        setSettings(dbSettings)
      } catch (err) {
        console.error('Could not load service desk data.', err)
        if (!cancelled) setLoadError('Could not load service desk data. Please refresh.')
      } finally {
        if (!cancelled) setDataLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  // Quiet background polling
  useEffect(() => {
    if (!user) return
    const id = setInterval(async () => {
      if (!userIdRef.current) return
      try {
        const [dbTickets, dbActivities] = await Promise.all([
          withTimeout(dbFetchTickets(), 8000, 'Refreshing tickets'),
          withTimeout(dbFetchActivities(), 8000, 'Refreshing activity'),
        ])
        setTickets(dbTickets)
        setActivities(dbActivities)
      } catch (err) {
        console.error('Background refresh failed.', err)
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [!!user])

  // Log "Signed in" activity once per session
  useEffect(() => {
    if (user && loggedInRef.current !== user.id) {
      loggedInRef.current = user.id
      dbLogActivity(user.id, 'Signed in to the IT Service Desk').catch((err) => console.error('Failed to log activity', err))
    }
    if (!user) loggedInRef.current = null
  }, [user?.id])

  const submitNewTicket = async (input: { title: string; category: string; doorNumber: string; priority: Priority; description: string }): Promise<Ticket> => {
    if (!user) throw new Error('You are signed out. Please sign in again.')
    const created = await dbCreateTicket({ ...input, department: user.department }, user.id)
    const withRequester: Ticket = { ...created, requester: user.name }
    setTickets((prev) => [withRequester, ...prev])
    dbLogActivity(user.id, `Reported a new issue: ${withRequester.title} (${withRequester.id})`).catch((err) => console.error('Failed to log activity', err))
    return withRequester
  }

  const submitAdminTicket = async (input: NewAdminTicketInput): Promise<Ticket> => {
    if (!user) throw new Error('You are signed out. Please sign in again.')
    const requester = [...employees, ...technicianUsers, ...seniorTechnicians, ...admins].find((p) => p.id === input.requesterId)
    if (!requester) throw new Error('Select who this ticket is for.')
    const assignee = input.assigneeId ? technicianUsers.find((t) => t.id === input.assigneeId) : undefined

    // Single insert carries the assignee straight into the row — no
    // separate update-by-name step that can silently miss.
    const created = await dbCreateTicket(
      { title: input.title, category: input.category, doorNumber: input.doorNumber, priority: input.priority, description: input.description, department: requester.department },
      requester.id,
      assignee?.id
    )
    const ticket: Ticket = {
      ...created,
      requester: requester.name,
      assignee: assignee ? assignee.name : 'Unassigned',
    }

    setTickets((prev) => [ticket, ...prev])
    const note = assignee
      ? `Created ticket ${ticket.id} for ${requester.name} and assigned it to ${assignee.name}`
      : `Created ticket ${ticket.id} for ${requester.name}`
    dbLogActivity(user.id, note).catch((err) => console.error('Failed to log activity', err))
    return ticket
  }

  const saveTicket = async (updated: Ticket): Promise<void> => {
    await dbUpdateTicket(updated, [...employees, ...technicianUsers])
    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    if (user) {
      const note = updated.assignee === 'Unassigned' ? `Set ${updated.id} to ${updated.status}` : `Updated ${updated.id}: ${updated.status} · assigned to ${updated.assignee}`
      dbLogActivity(user.id, note).catch((err) => console.error('Failed to log activity', err))
    }
  }

  const deleteTicketHandler = async (id: string): Promise<void> => {
    await dbDeleteTicket(id)
    setTickets((prev) => prev.filter((t) => t.id !== id))
    if (user) {
      dbLogActivity(user.id, `Deleted ticket ${id}`).catch((err) => console.error('Failed to log activity', err))
    }
  }

  const openTicket = (t: Ticket) => {
    setSelectedTicketId(t.id)
    setActive('Request detail')
  }

  const addTeamMember = async (input: NewMember) => {
    await createTeamMember(input)
    const people = await dbFetchEmployees()
    setEmployees(people.filter((p) => p.role === 'Employee'))
    setTechnicianUsers(people.filter((p) => p.role === 'Technician'))
    setSeniorTechnicians(people.filter((p) => p.role === 'Senior Technician'))
    setAdmins(people.filter((p) => p.role === 'Administrator'))
  }

  const deleteTeamMemberHandler = async (id: string) => {
    await dbDeleteEmployee(id)
    setEmployees((prev) => prev.filter((p) => p.id !== id))
    setTechnicianUsers((prev) => prev.filter((p) => p.id !== id))
    setSeniorTechnicians((prev) => prev.filter((p) => p.id !== id))
    setAdmins((prev) => prev.filter((p) => p.id !== id))
  }

  const createArticleHandler = async (input: { title: string; category: string; body: string }) => {
    if (!user) throw new Error('You are signed out. Please sign in again.')
    const created = await dbCreateArticle(input, user.id)
    setArticles((prev) => [created, ...prev])
  }

  const updateArticleHandler = async (id: string, input: { title: string; category: string; body: string }) => {
    const updated = await dbUpdateArticle(id, input)
    setArticles((prev) => prev.map((a) => (a.id === id ? updated : a)))
  }

  const deleteArticleHandler = async (id: string) => {
    await dbDeleteArticle(id)
    setArticles((prev) => prev.filter((a) => a.id !== id))
  }

  const saveSettings = async (next: ServiceDeskSettings) => {
    await dbUpdateSettings(next)
    setSettings(next)
  }

  const saveProfile = async (name: string) => {
    if (!user) throw new Error('You are signed out. Please sign in again.')
    const updated = await dbUpdateEmployeeProfile(user.id, name)
    setUser(updated)
    if (user.role === 'Employee') setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
    else if (user.role === 'Technician') setTechnicianUsers((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
    else setAdmins((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
  }

  const handleLogout = async () => {
    try {
      await signOut()
    } catch (err) {
      console.error('Sign out failed', err)
    }
  }

  if (loadError)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f7fa] p-6">
        <div className="max-w-md rounded-2xl border border-[#f7c5bd] bg-[#fff0ee] p-6 text-sm text-[#bd3c2d]">
          <p className="font-bold">Couldn't connect to Supabase</p>
          <p className="mt-2 leading-6">{loadError}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-[#bd3c2d] px-4 py-2 text-sm font-bold text-white">
            Try again
          </button>
        </div>
      </div>
    )
  if (authChecking) return <div className="flex min-h-screen items-center justify-center bg-[#f4f7fa] text-sm text-[#71899a]">Checking your session…</div>
  if (profileMissing)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f7fa] p-6">
        <div className="max-w-md rounded-2xl border border-[#dce7ed] bg-white p-6 text-center shadow-[0_18px_45px_rgba(20,53,77,.08)]">
          <p className="font-serif text-xl font-bold">Account not linked</p>
          <p className="mt-3 text-sm leading-6 text-[#648096]">
            You're signed in, but this account isn't linked to an employee profile yet. Ask an administrator to create your account in Team settings, then sign in again.
          </p>
          <button onClick={handleLogout} className="mt-5 rounded-xl bg-[#24769f] px-5 py-2.5 text-sm font-bold text-white">
            Sign out
          </button>
        </div>
      </div>
    )
  if (!user) return <Login />
  if (dataLoading) return <div className="flex min-h-screen items-center justify-center bg-[#f4f7fa] text-sm text-[#71899a]">Loading service desk data…</div>

  const go = (x: string) => setActive(x)
  const openCount = tickets.filter((t) => t.status !== 'Resolved').length
  let content: React.ReactNode

  if (role === 'employee') {
    const selectedTicket = selectedTicketId ? tickets.find((t) => t.id === selectedTicketId) ?? null : null
    content =
      active === 'New request' ? (
        <NewRequest onBack={() => go('My overview')} onSubmit={submitNewTicket} />
      ) : active === 'My requests' ? (
        <EmployeeRequests user={user} tickets={tickets} onOpen={openTicket} />
      ) : active === 'Help articles' ? (
        <HelpArticles articles={articles} />
      ) : active === 'My profile' ? (
        <Profile user={user} onSave={saveProfile} />
      ) : active === 'Request detail' && selectedTicket ? (
        <RequestDetail ticket={selectedTicket} onBack={() => go('My requests')} />
      ) : (
        <EmployeeOverview user={user} go={go} tickets={tickets} onOpen={openTicket} />
      )
  } else if (role === 'admin') {
    content = (
      <AdminWorkspace
        tickets={tickets}
        onSaveTicket={saveTicket}
        onDeleteTicket={deleteTicketHandler}
        active={active}
        setActive={go}
        employees={employees}
        technicians={technicianUsers}
        seniorTechnicians={seniorTechnicians}
        admins={admins}
        onAddMember={addTeamMember}
        onDeleteMember={deleteTeamMemberHandler}
        user={user}
        articles={articles}
        onCreateArticle={createArticleHandler}
        onUpdateArticle={updateArticleHandler}
        onDeleteArticle={deleteArticleHandler}
        settings={settings}
        onSaveSettings={saveSettings}
        onCreateTicket={submitAdminTicket}
      />
    )
  } else if (role === 'senior_technician') {
    // Read-only monitor: no assignment, status, or profile controls — just
    // every assigned issue grouped by technician, with a delete action.
    content = <SeniorTechnicianMonitor tickets={tickets} onDeleteTicket={deleteTicketHandler} />
  } else {
    content = (
      <TechnicianWorkspace
        tickets={tickets}
        onSaveTicket={saveTicket}
        active={active}
        setActive={go}
        technicians={technicianUsers}
        user={user}
        articles={articles}
        onSaveProfile={saveProfile}
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#f4f7fa] text-[#183148]">
      <div className="flex min-h-screen">
        <Sidebar role={role} active={active} setActive={go} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} openCount={openCount} />
        <div className="min-w-0 flex-1">
          <Header user={user} activities={activities} setMobileOpen={setMobileOpen} onLogout={handleLogout} />
          {content}
        </div>
      </div>
    </div>
  )
}