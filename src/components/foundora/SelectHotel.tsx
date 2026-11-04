'use client'

import { useEffect } from 'react'
import { useGuestExperience } from './GuestExperience'

// On a hotel's own address (/h/<slug>), choose that hotel so the guest never
// has to pick it again.
export default function SelectHotel({ code }: { code: string }) {
  const { selectHotel, hotel } = useGuestExperience()
  useEffect(() => {
    if (hotel?.inn_code !== code) selectHotel(code)
  }, [code, hotel?.inn_code, selectHotel])
  return null
}
