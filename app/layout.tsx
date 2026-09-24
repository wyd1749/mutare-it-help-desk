import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { RegisterServiceWorker } from '@/components/register-sw'
import { InstallPrompt } from '@/components/install-prompt'
import './globals.css'

export const metadata: Metadata = {
  title: 'IT Service Desk | Mutare City Council',
  description: 'Internal IT support portal for Mutare City Council employees.',
  generator: 'Mutare City Council',
  manifest: '/manifest.json',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <RegisterServiceWorker />
        <InstallPrompt />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}