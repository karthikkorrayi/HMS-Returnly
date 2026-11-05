'use client'

import { createContext, useCallback, useContext } from 'react'
import { staffPath } from '@/lib/staff-paths'

// The signed-in person's hotel address, for links in client components:
//   const to = useStaffPath(); <Link href={to('/items')}>
const StaffHotel = createContext<string>('')

export function StaffHotelProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  return <StaffHotel.Provider value={slug}>{children}</StaffHotel.Provider>
}

export function useStaffPath(): (path: string) => string {
  const slug = useContext(StaffHotel)
  return useCallback((path: string) => (slug ? staffPath(slug, path) : path), [slug])
}
