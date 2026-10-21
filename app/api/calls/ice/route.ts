import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Hands the browser its STUN/TURN server list. The TURN credentials live in
// server environment variables and are only given to signed-in users.
//
// Option 1 (Metered or similar, fetched fresh each time):
//   METERED_DOMAIN=yourapp.metered.live   METERED_API_KEY=...
// Option 2 (static TURN server, e.g. your own coturn):
//   TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
//   TURN_USERNAME=...   TURN_CREDENTIAL=...
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const iceServers: Record<string, unknown>[] = [{ urls: 'stun:stun.l.google.com:19302' }]

  const domain = process.env.METERED_DOMAIN
  const apiKey = process.env.METERED_API_KEY
  if (domain && apiKey) {
    try {
      const res = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`, {
        cache: 'no-store',
      })
      if (res.ok) {
        const list = await res.json()
        if (Array.isArray(list)) iceServers.push(...list)
      }
    } catch (err) {
      console.error('TURN provider fetch failed', err)
    }
  } else if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    })
  }

  return Response.json({ iceServers }, { headers: { 'Cache-Control': 'no-store' } })
}