'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, ChevronDown, Mic, MicOff, Phone, PhoneIncoming, PhoneMissed, PhoneOff, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { subscribeToPush } from '@/lib/push'
import type { Employee } from '@/lib/supabase/queries'
import {
  RING_TIMEOUT_MS,
  fetchCallHistory,
  fetchIceServers,
  fetchRingingFor,
  insertCall,
  listCallTargets,
  ringCallee,
  updateCallIf,
  type CallRow,
  type CallTarget,
} from '@/lib/supabase/calls'

type Phase = 'idle' | 'calling' | 'incoming' | 'connecting' | 'live'
type Peer = { id: string; name: string }

// ---- ringtone (generated in the browser, no audio file needed) ----
function useRingtone() {
  const ctxRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if ('vibrate' in navigator) navigator.vibrate(0)
  }, [])

  const start = useCallback(() => {
    stop()
    const beep = () => {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        ctxRef.current = ctxRef.current ?? new Ctx()
        const ctx = ctxRef.current
        void ctx.resume()
        const now = ctx.currentTime
        for (const offset of [0, 0.35]) {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.frequency.value = 880
          gain.gain.setValueAtTime(0.0001, now + offset)
          gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.03)
          gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28)
          osc.connect(gain).connect(ctx.destination)
          osc.start(now + offset)
          osc.stop(now + offset + 0.3)
        }
      } catch {
        // Autoplay can be blocked until the person taps something; the popup still shows.
      }
      if ('vibrate' in navigator) navigator.vibrate([300, 150, 300])
    }
    beep()
    timerRef.current = setInterval(beep, 2200)
  }, [stop])

  useEffect(() => stop, [stop])
  return { start, stop }
}

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDuration(call: CallRow) {
  if (!call.answered_at || !call.ended_at) return ''
  const secs = Math.max(0, Math.round((new Date(call.ended_at).getTime() - new Date(call.answered_at).getTime()) / 1000))
  return formatClock(secs)
}

function formatWhen(iso: string) {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay ? `Today, ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`
}

export function CallProvider({ me, children }: { me: Employee; children: React.ReactNode }) {
  const isAdmin = me.role === 'Administrator'

  const [phase, setPhase] = useState<Phase>('idle')
  const [peer, setPeer] = useState<Peer | null>(null)
  const [muted, setMuted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [targets, setTargets] = useState<CallTarget[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<CallRow[]>([])
  const [lastSeen, setLastSeen] = useState<number>(0)
  const [pushState, setPushState] = useState<'unknown' | 'on' | 'off' | 'unsupported'>('unknown')

  // Everything that must survive re-renders without causing them.
  const phaseRef = useRef<Phase>('idle')
  const callIdRef = useRef<string | null>(null)
  const roleRef = useRef<'caller' | 'callee' | null>(null)
  const incomingRef = useRef<CallRow | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const pendingIce = useRef<RTCIceCandidateInit[]>([])
  const ringTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ringtone = useRingtone()

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    setTimeout(() => setNotice((current) => (current === text ? null : current)), 6000)
  }, [])

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await fetchCallHistory())
    } catch {
      // history is a convenience; ignore failures
    }
  }, [])

  // Tidy up everything about the current call.
  const cleanup = useCallback(() => {
    if (ringTimeout.current) clearTimeout(ringTimeout.current)
    ringTimeout.current = null
    ringtone.stop()
    pcRef.current?.close()
    pcRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (channelRef.current) void createClient().removeChannel(channelRef.current)
    channelRef.current = null
    if (audioRef.current) audioRef.current.srcObject = null
    pendingIce.current = []
    callIdRef.current = null
    roleRef.current = null
    incomingRef.current = null
    setMuted(false)
    setSeconds(0)
    setPeer(null)
    setPhaseBoth('idle')
  }, [ringtone])

  const sendSignal = (event: string, payload: unknown = {}) => {
    void channelRef.current?.send({ type: 'broadcast', event, payload })
  }

  const flushIce = async () => {
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) return
    for (const c of pendingIce.current.splice(0)) {
      try {
        await pc.addIceCandidate(c)
      } catch {
        // a stale candidate is harmless
      }
    }
  }

  const buildPeer = async () => {
    const pc = new RTCPeerConnection({ iceServers: await fetchIceServers() })
    pcRef.current = pc
    streamRef.current?.getTracks().forEach((t) => pc.addTrack(t, streamRef.current as MediaStream))
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal('ice', e.candidate.toJSON())
    }
    pc.ontrack = (e) => {
      if (audioRef.current) {
        audioRef.current.srcObject = e.streams[0]
        void audioRef.current.play().catch(() => {})
      }
    }
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return
      if (pc.connectionState === 'connected') {
        setPhaseBoth('live')
      } else if (pc.connectionState === 'failed') {
        void endCall('The connection failed. This is usually a network that blocks calls.', 'ended')
      }
    }
    return pc
  }

  // Opens the private signalling channel for one call and resolves once joined.
  const openChannel = (callId: string) =>
    new Promise<void>((resolve, reject) => {
      const supabase = createClient()
      const ch = supabase.channel(`call-${callId}`, { config: { broadcast: { self: false } } })
      channelRef.current = ch
      ch.on('broadcast', { event: 'ready' }, async () => {
        // Caller side: the person called answered, so start the connection.
        if (roleRef.current !== 'caller' || pcRef.current) return
        if (ringTimeout.current) clearTimeout(ringTimeout.current)
        setPhaseBoth('connecting')
        try {
          const pc = await buildPeer()
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          sendSignal('offer', { type: offer.type, sdp: offer.sdp })
        } catch {
          void endCall('Could not start the call.', 'ended')
        }
      })
        .on('broadcast', { event: 'offer' }, async ({ payload }) => {
          const pc = pcRef.current
          if (roleRef.current !== 'callee' || !pc) return
          try {
            await pc.setRemoteDescription(payload as RTCSessionDescriptionInit)
            await flushIce()
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            sendSignal('answer', { type: answer.type, sdp: answer.sdp })
          } catch {
            void endCall('Could not connect the call.', 'ended')
          }
        })
        .on('broadcast', { event: 'answer' }, async ({ payload }) => {
          const pc = pcRef.current
          if (roleRef.current !== 'caller' || !pc) return
          try {
            await pc.setRemoteDescription(payload as RTCSessionDescriptionInit)
            await flushIce()
          } catch {
            void endCall('Could not connect the call.', 'ended')
          }
        })
        .on('broadcast', { event: 'ice' }, async ({ payload }) => {
          const pc = pcRef.current
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(payload as RTCIceCandidateInit)
            } catch {
              // ignore
            }
          } else {
            pendingIce.current.push(payload as RTCIceCandidateInit)
          }
        })
        .on('broadcast', { event: 'hangup' }, () => {
          if (phaseRef.current === 'idle') return
          showNotice('The call ended.')
          cleanup()
          void refreshHistory()
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve()
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('Could not reach the call service.'))
        })
    })

  // Ends or cancels the current call, whatever stage it is at.
  const endCall = async (message?: string, finalStatus: 'ended' | 'declined' = 'ended') => {
    const id = callIdRef.current
    const wasPhase = phaseRef.current
    const role = roleRef.current
    if (id) {
      try {
        if (wasPhase === 'live' || wasPhase === 'connecting') {
          await updateCallIf(id, ['active'], { status: 'ended', ended_at: new Date().toISOString() })
        } else if (role === 'caller') {
          await updateCallIf(id, ['ringing'], { status: 'missed', ended_at: new Date().toISOString() })
        } else if (role === 'callee') {
          await updateCallIf(id, ['ringing'], { status: finalStatus === 'declined' ? 'declined' : 'ended', ended_at: new Date().toISOString() })
        }
      } catch {
        // the other side is told below either way
      }
      sendSignal('hangup')
    }
    if (message) showNotice(message)
    cleanup()
    void refreshHistory()
  }

  const getMic = async () => {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      return true
    } catch {
      showNotice('Microphone access is needed for calls. Allow it in your browser settings, then try again.')
      return false
    }
  }

  // ---- caller ----
  const placeCall = async (target: CallTarget) => {
    setPickerOpen(false)
    if (phaseRef.current !== 'idle') return
    if (!navigator.mediaDevices?.getUserMedia) {
      showNotice('This browser cannot make calls. Try Chrome, Edge, Safari or Firefox over a secure (https) connection.')
      return
    }
    if (!(await getMic())) return
    setPeer(target)
    roleRef.current = 'caller'
    setPhaseBoth('calling')
    try {
      const row = await insertCall(me.id, target.id)
      callIdRef.current = row.id
      await openChannel(row.id)
      void ringCallee(row.id)
      ringTimeout.current = setTimeout(() => {
        void endCall(`${target.name} did not answer.`)
      }, RING_TIMEOUT_MS)
    } catch {
      cleanup()
      showNotice('Could not place the call. Check your connection and try again.')
    }
  }

  // ---- person being called ----
  const showIncoming = (row: CallRow) => {
    if (phaseRef.current !== 'idle') {
      // Already on a call: this one is recorded as missed.
      void updateCallIf(row.id, ['ringing'], { status: 'missed', ended_at: new Date().toISOString() }).catch(() => {})
      return
    }
    incomingRef.current = row
    callIdRef.current = row.id
    roleRef.current = 'callee'
    setPeer({ id: row.caller_id, name: row.caller_name ?? 'A colleague' })
    setPhaseBoth('incoming')
    ringtone.start()
    const remaining = Math.max(1000, RING_TIMEOUT_MS - (Date.now() - new Date(row.created_at).getTime()))
    ringTimeout.current = setTimeout(() => {
      if (phaseRef.current === 'incoming') {
        showNotice(`Missed call from ${row.caller_name ?? 'a colleague'}.`)
        cleanup()
        void refreshHistory()
      }
    }, remaining)
  }

  const acceptCall = async () => {
    const row = incomingRef.current
    if (!row) return
    ringtone.stop()
    if (ringTimeout.current) clearTimeout(ringTimeout.current)
    if (!navigator.mediaDevices?.getUserMedia || !(await getMic())) {
      void updateCallIf(row.id, ['ringing'], { status: 'declined', ended_at: new Date().toISOString() }).catch(() => {})
      cleanup()
      return
    }
    setPhaseBoth('connecting')
    try {
      await openChannel(row.id)
      await buildPeer()
      const stillRinging = await updateCallIf(row.id, ['ringing'], { status: 'active', answered_at: new Date().toISOString() })
      if (!stillRinging) {
        showNotice('That call ended before you could answer.')
        cleanup()
        void refreshHistory()
        return
      }
      sendSignal('ready')
    } catch {
      showNotice('Could not answer the call. Please try again.')
      cleanup()
    }
  }

  const declineCall = () => void endCall(undefined, 'declined')

  const toggleMute = () => {
    const track = streamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
  }

  // Latest handlers for the realtime listener (avoids stale closures).
  const onCallEvent = useRef<(type: 'INSERT' | 'UPDATE', row: CallRow) => void>(() => {})
  onCallEvent.current = (type, row) => {
    if (type === 'INSERT' && row.callee_id === me.id && row.status === 'ringing') {
      showIncoming(row)
    } else if (type === 'UPDATE' && row.id === callIdRef.current) {
      if (roleRef.current === 'caller' && row.status === 'declined' && phaseRef.current === 'calling') {
        showNotice(`${row.callee_name ?? 'They'} declined the call.`)
        cleanup()
      } else if (roleRef.current === 'callee' && row.status === 'missed' && phaseRef.current === 'incoming') {
        showNotice(`Missed call from ${row.caller_name ?? 'a colleague'}.`)
        cleanup()
      }
    }
    void refreshHistory()
  }

  // Listen for calls involving me. Row-level security means I only ever
  // receive calls where I am the caller or the person called.
  useEffect(() => {
    const supabase = createClient()
    const feed = supabase
      .channel(`calls-feed-${me.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, (p) => onCallEvent.current('INSERT', p.new as CallRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, (p) => onCallEvent.current('UPDATE', p.new as CallRow))
      .subscribe()

    // Catch a call that started while the site was closed (opened from the
    // ring notification) or while the connection was briefly down.
    const checkRinging = async () => {
      if (phaseRef.current !== 'idle') return
      try {
        const [row] = await fetchRingingFor(me.id)
        if (row) showIncoming(row)
      } catch {
        // ignore
      }
    }
    void checkRinging()
    const onVisible = () => document.visibilityState === 'visible' && void checkRinging()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(feed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id])

  // Who can be called, call history, and the "last looked" marker for the missed-call badge.
  useEffect(() => {
    listCallTargets().then(setTargets).catch(() => setTargets([]))
    void refreshHistory()
    try {
      setLastSeen(Number(localStorage.getItem(`calls:lastSeen:${me.id}`) || 0))
    } catch {
      // storage can be blocked
    }
    if (typeof window === 'undefined' || !('Notification' in window)) setPushState('unsupported')
    else setPushState(Notification.permission === 'granted' ? 'on' : 'off')
    if ('Notification' in window && Notification.permission === 'granted') void subscribeToPush()
  }, [me.id, refreshHistory])

  // Call timer
  useEffect(() => {
    if (phase !== 'live') return
    const started = Date.now()
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(t)
  }, [phase])

  // Hang up cleanly if the tab is closed mid-call.
  useEffect(() => {
    const onLeave = () => {
      if (phaseRef.current !== 'idle') void endCall()
    }
    window.addEventListener('pagehide', onLeave)
    return () => {
      window.removeEventListener('pagehide', onLeave)
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enableRingAlerts = async () => {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    setPushState(result === 'granted' ? 'on' : 'off')
    if (result === 'granted') {
      const status = await subscribeToPush()
      if (status === 'failed') showNotice('Could not turn on call alerts for this device.')
    }
  }

  const openHistory = () => {
    setHistoryOpen(true)
    void refreshHistory()
    const now = Date.now()
    setLastSeen(now)
    try {
      localStorage.setItem(`calls:lastSeen:${me.id}`, String(now))
    } catch {
      // ignore
    }
  }

  const missedCount = history.filter((c) => c.callee_id === me.id && c.status === 'missed' && new Date(c.created_at).getTime() > lastSeen).length
  const busy = phase !== 'idle'

  return (
    <>
      {children}
      <audio ref={audioRef} autoPlay playsInline />

      {/* Floating call controls */}
      {!busy && (
        <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
          {notice && (
            <div role="status" className="max-w-[18rem] rounded-xl border border-[#dce7ed] bg-white px-4 py-3 text-sm font-semibold text-[#183148] shadow-[0_12px_30px_rgba(20,53,77,.18)]">
              {notice}
            </div>
          )}
          {pickerOpen && targets.length > 0 && (
            <div className="w-72 rounded-2xl border border-[#dce7ed] bg-white p-2 shadow-[0_18px_45px_rgba(20,53,77,.18)]">
              <p className="px-3 py-2 text-xs font-bold text-[#648096]">Who do you want to call?</p>
              {targets.length > 6 && (
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or role"
                  aria-label="Search people to call"
                  className="mb-1 w-full rounded-xl border border-[#dce7ed] px-3 py-2 text-sm outline-none focus:border-[#24769f]"
                />
              )}
              <div className="max-h-64 overflow-y-auto">
                {targets
                  .filter((t) => `${t.name} ${t.role ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
                  .map((t) => (
                    <button key={t.id} onClick={() => placeCall(t)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#eef5f9]">
                      <Phone size={16} className="shrink-0 text-[#24769f]" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-[#183148]">{t.name}</span>
                        {t.role && <span className="block truncate text-xs text-[#648096]">{t.role}</span>}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={openHistory}
              aria-label="Call history"
              className="relative flex h-12 w-12 items-center justify-center rounded-full border border-[#dce7ed] bg-white text-[#24769f] shadow-[0_12px_30px_rgba(20,53,77,.18)] hover:bg-[#eef5f9]"
            >
              <PhoneIncoming size={20} />
              {missedCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#bd3c2d] px-1 text-[11px] font-bold text-white">{missedCount}</span>
              )}
            </button>
            <button
              onClick={() => {
                setSearch('')
                if (!isAdmin && targets.length === 1) void placeCall(targets[0])
                else setPickerOpen((o) => !o)
              }}
              disabled={targets.length === 0}
              className="flex h-12 items-center gap-2 rounded-full bg-[#24769f] px-5 text-sm font-bold text-white shadow-[0_12px_30px_rgba(20,53,77,.28)] hover:bg-[#1d6285] disabled:cursor-not-allowed disabled:bg-[#9db6c4]"
            >
              <Phone size={18} />
              {targets.length === 0 ? (isAdmin ? 'No one to call' : 'No CTO available') : isAdmin ? 'Call someone' : 'Call the CTO'}
              {(isAdmin || targets.length > 1) && <ChevronDown size={16} />}
            </button>
          </div>
        </div>
      )}

      {/* Ringing / in-call panel */}
      {busy && peer && (
        <div
          role={phase === 'incoming' ? 'alertdialog' : 'dialog'}
          aria-live="assertive"
          aria-label={phase === 'incoming' ? `Incoming call from ${peer.name}` : `Call with ${peer.name}`}
          className="fixed inset-x-4 bottom-4 z-50 rounded-2xl bg-[#183148] p-5 text-white shadow-[0_24px_60px_rgba(8,24,38,.45)] sm:left-auto sm:right-4 sm:w-80"
        >
          <p className="text-xs font-bold text-[#9fc3d6]">
            {phase === 'incoming' && 'Incoming call'}
            {phase === 'calling' && 'Calling…'}
            {phase === 'connecting' && 'Connecting…'}
            {phase === 'live' && formatClock(seconds)}
          </p>
          <p className="mt-1 font-serif text-2xl font-bold">{peer.name}</p>
          {phase === 'calling' && <p className="mt-1 text-sm text-[#b8d2df]">Ringing. They have {RING_TIMEOUT_MS / 1000} seconds to answer.</p>}
          {phase === 'live' && muted && <p className="mt-1 text-sm text-[#f7c5bd]">Your microphone is muted.</p>}

          <div className="mt-5 flex items-center gap-3">
            {phase === 'incoming' ? (
              <>
                <button onClick={acceptCall} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#2f9e62] py-3 text-sm font-bold text-white hover:bg-[#268552]">
                  <Phone size={18} /> Accept
                </button>
                <button onClick={declineCall} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#bd3c2d] py-3 text-sm font-bold text-white hover:bg-[#9f3124]">
                  <PhoneOff size={18} /> Decline
                </button>
              </>
            ) : (
              <>
                {phase === 'live' && (
                  <button
                    onClick={toggleMute}
                    aria-pressed={muted}
                    aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                    className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
                  >
                    {muted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                )}
                <button onClick={() => endCall()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#bd3c2d] py-3 text-sm font-bold text-white hover:bg-[#9f3124]">
                  <PhoneOff size={18} /> {phase === 'calling' ? 'Cancel' : 'Hang up'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Call history */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-[#183148]/40 p-4 sm:items-stretch" onClick={() => setHistoryOpen(false)}>
          <div
            role="dialog"
            aria-label="Call history"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-full flex-col rounded-2xl bg-white shadow-[0_24px_60px_rgba(8,24,38,.35)] sm:max-h-none sm:w-96"
          >
            <div className="flex items-center justify-between border-b border-[#e4edf2] px-5 py-4">
              <h2 className="font-serif text-lg font-bold text-[#183148]">Call history</h2>
              <button onClick={() => setHistoryOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-[#648096] hover:bg-[#eef5f9]">
                <X size={18} />
              </button>
            </div>

            {pushState === 'off' && (
              <button onClick={enableRingAlerts} className="mx-5 mt-4 flex items-center gap-2 rounded-xl bg-[#eef5f9] px-4 py-3 text-left text-sm font-bold text-[#24769f] hover:bg-[#dfecf3]">
                <Bell size={16} /> Turn on ringing when the site is closed
              </button>
            )}
            {pushState === 'on' && <p className="mx-5 mt-4 text-xs text-[#648096]">Ringing alerts are on for this device.</p>}

            <ul className="min-h-0 flex-1 divide-y divide-[#eef3f6] overflow-y-auto px-2 py-2">
              {history.length === 0 && <li className="px-3 py-8 text-center text-sm text-[#648096]">No calls yet.</li>}
              {history.map((c) => {
                const outgoing = c.caller_id === me.id
                const other = outgoing ? c.callee_name : c.caller_name
                const missed = c.status === 'missed' && !outgoing
                const label =
                  c.status === 'missed' ? (outgoing ? 'Not answered' : 'Missed') : c.status === 'declined' ? 'Declined' : c.status === 'ringing' ? 'Ringing' : c.status === 'active' ? 'In progress' : `Answered ${formatDuration(c)}`.trim()
                return (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${missed ? 'bg-[#fff0ee] text-[#bd3c2d]' : 'bg-[#eef5f9] text-[#24769f]'}`}>
                      {missed ? <PhoneMissed size={16} /> : outgoing ? <Phone size={16} /> : <PhoneIncoming size={16} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-bold ${missed ? 'text-[#bd3c2d]' : 'text-[#183148]'}`}>{other ?? 'Unknown'}</span>
                      <span className="block text-xs text-[#648096]">
                        {outgoing ? 'Outgoing' : 'Incoming'} · {label}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-[#648096]">{formatWhen(c.created_at)}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}