import type { NextConfig } from 'next'
import { SECURITY_HEADERS } from './src/lib/security-headers'

const nextConfig: NextConfig = {
  // Lets a phone on the same Wi-Fi use the dev server (HMR, dev assets).
  // Set DEV_LAN_HOST in .env.local to your computer's LAN IP, e.g. 192.168.1.20.
  allowedDevOrigins: process.env.DEV_LAN_HOST ? [process.env.DEV_LAN_HOST] : [],
  // Don't announce the framework in every response.
  poweredByHeader: false,
  // Browser security rules for every response (src/lib/security-headers.ts).
  // The page Content Security Policy is set per request in src/proxy.ts.
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      // API answers (JSON, photos) are never shown inside another site.
      { source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] },
    ]
  },
}

export default nextConfig
