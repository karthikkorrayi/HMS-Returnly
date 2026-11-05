'use client'

import { useEffect, useRef } from 'react'
import { useGuestExperience } from './GuestExperience'

// On a hotel's own address (/h/<slug>), choose that hotel so the guest never
// has to pick it again.
export default function SelectHotel({ code }: { code: string }) {
  const { selectHotel } = useGuestExperience()
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (applied.current !== code) { applied.current = code; selectHotel(code) }
  }, [code, selectHotel])
  return null
}
