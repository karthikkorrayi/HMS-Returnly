import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/public-sans'
import './globals.css'

export const metadata: Metadata = {
  title: 'Returnly — Lost & Found',
  description: 'Hotel lost property log',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#0b6468',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  )
}
