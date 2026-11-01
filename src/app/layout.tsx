import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import '@fontsource-variable/public-sans'
import './globals.css'
import './foundora.css'
import GuestExperience from '@/components/foundora/GuestExperience'
import { themeInit } from '@/components/foundora/Theme'
import { loadGuestPresentation } from '@/lib/guest-presentation'
import { hotelToday } from '@/lib/format'

export const metadata: Metadata = {
  title: 'Foundora — Lost & Found, Made Simple.',
  description: 'Hotel lost property enquiries and secure staff workspace',
  robots: { index: false, follow: false },
}
export const viewport: Viewport = {
  themeColor: '#082b68',
  width: 'device-width',
  initialScale: 1,
}
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reuse the per-request CSP nonce created by Railway's existing proxy.
  // No inline-script exemption or security-header change is needed.
  const policy = (await headers()).get('content-security-policy') ?? ''
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1]
  const { hotels, contacts } = await loadGuestPresentation()
  return (
    <html lang="en-GB" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full">
        <GuestExperience
          hotels={hotels}
          contacts={contacts}
          today={hotelToday()}
        >
          {children}
        </GuestExperience>
      </body>
    </html>
  )
}
