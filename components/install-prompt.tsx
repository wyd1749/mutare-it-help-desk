'use client'

import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

// Chrome/Edge fire this instead of showing their own install UI, so we can
// hold onto it and trigger the native install dialog from our own button.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'it-service-desk-install-dismissed'

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Already installed (running standalone) — nothing to offer.
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    if (isStandalone) return

    if (localStorage.getItem(DISMISS_KEY) === '1') return

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    const onInstalled = () => {
      setVisible(false)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!visible || !deferredPrompt) return null

  const install = async () => {
    setVisible(false)
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  const dismiss = () => {
    setVisible(false)
    localStorage.setItem(DISMISS_KEY, '1')
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-2xl border border-[#dbe6ec] bg-white p-4 shadow-lg">
      <div className="text-sm">
        <p className="font-bold text-[#2b3a44]">Install IT Service Desk</p>
        <p className="text-[#71899a]">Add it to this device for quick, full-screen access.</p>
      </div>
      <button
        onClick={install}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#24769f] px-3 py-2 text-xs font-bold text-white hover:bg-[#1d6188]"
      >
        <Download size={14} /> Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-[#8aa0ae] hover:text-[#2b3a44]">
        <X size={16} />
      </button>
    </div>
  )
}
