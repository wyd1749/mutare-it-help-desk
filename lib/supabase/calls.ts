import { createClient } from './client'

export type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed'

export type CallRow = {
  id: string
  caller_id: string
  callee_id: string
  caller_name: string | null
  callee_name: string | null
  status: CallStatus
  created_at: string
  answered_at: string | null
  ended_at: string | null
}

export type CallTarget = { id: string; name: string; role?: string }

const COLUMNS = 'id,caller_id,callee_id,caller_name,callee_name,status,created_at,answered_at,ended_at'

// A call that nobody picks up within this time counts as missed.
export const RING_TIMEOUT_MS = 45000

export async function listCallTargets(): Promise<CallTarget[]> {
  const { data, error } = await createClient().rpc('call_targets')
  if (error) throw error
  return (data ?? []) as CallTarget[]
}

export async function insertCall(callerId: string, calleeId: string): Promise<CallRow> {
  const { data, error } = await createClient()
    .from('calls')
    .insert({ caller_id: callerId, callee_id: calleeId, status: 'ringing' })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as CallRow
}

// Changes a call only if it is still in one of the given states. Returns false
// when nothing changed (for example, the caller hung up before you answered).
export async function updateCallIf(
  id: string,
  fromStatuses: CallStatus[],
  patch: Partial<Pick<CallRow, 'status' | 'answered_at' | 'ended_at'>>
): Promise<boolean> {
  const { data, error } = await createClient()
    .from('calls')
    .update(patch)
    .eq('id', id)
    .in('status', fromStatuses)
    .select('id')
  if (error) throw error
  return !!data && data.length > 0
}

export async function fetchCallHistory(limit = 50): Promise<CallRow[]> {
  const { data, error } = await createClient()
    .from('calls')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as CallRow[]
}

// Calls that are ringing for this person right now (used when the app is
// opened from a call notification, or after a dropped connection).
export async function fetchRingingFor(employeeId: string): Promise<CallRow[]> {
  const since = new Date(Date.now() - RING_TIMEOUT_MS).toISOString()
  const { data, error } = await createClient()
    .from('calls')
    .select(COLUMNS)
    .eq('callee_id', employeeId)
    .eq('status', 'ringing')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CallRow[]
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await createClient().auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch('/api/calls/ice', { headers: await authHeader(), cache: 'no-store' })
    if (res.ok) {
      const body = await res.json()
      if (Array.isArray(body.iceServers) && body.iceServers.length) return body.iceServers
    }
  } catch {
    // fall through to the public STUN server
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }]
}

// Asks the server to send a push notification so the callee's phone rings
// even when the site is closed. Failure is fine: the live ring still works.
export async function ringCallee(callId: string): Promise<void> {
  try {
    await fetch('/api/calls/ring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ callId }),
    })
  } catch {
    // ignore
  }
}

// --- On/off switch for the whole calling feature (the CTO controls it) ---

// If the setting can't be read (for example the SQL has not been run yet),
// calling stays on so nothing breaks.
export async function fetchCallsEnabled(): Promise<boolean> {
  try {
    const { data, error } = await createClient().from('call_settings').select('calls_enabled').eq('id', true).maybeSingle()
    if (error || !data) return true
    return data.calls_enabled !== false
  } catch {
    return true
  }
}

export async function saveCallsEnabled(enabled: boolean, byEmployeeId: string): Promise<boolean> {
  const { data, error } = await createClient()
    .from('call_settings')
    .update({ calls_enabled: enabled, updated_at: new Date().toISOString(), updated_by: byEmployeeId })
    .eq('id', true)
    .select('calls_enabled')
  if (error) throw error
  return !!data && data.length > 0
}