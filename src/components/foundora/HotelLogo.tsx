'use client'
import { logoPath } from '@/lib/branding-paths'
export default function HotelLogo({ slug, version, name }: { slug: string; version: number; name: string }) {
  const src = logoPath(slug, version)
  return <span className="hotel-logo-plate">
    {/* eslint-disable-next-line @next/next/no-img-element -- permission-scoped public branding endpoint */}
    <img className="brand-light" src={src} alt={name} width="180" height="60" />
    {/* eslint-disable-next-line @next/next/no-img-element -- dark endpoint falls back to the standard logo */}
    <img className="brand-dark" src={`${src}&theme=dark`} alt={name} width="180" height="60" />
  </span>
}
