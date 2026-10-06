import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Lets a phone on the same Wi-Fi use the dev server (HMR, dev assets).
  // Set DEV_LAN_HOST in .env.local to your computer's LAN IP, e.g. 192.168.1.20.
  allowedDevOrigins: process.env.DEV_LAN_HOST ? [process.env.DEV_LAN_HOST] : [],
}

export default nextConfig
