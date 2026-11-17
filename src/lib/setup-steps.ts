// The first-time setup form is shown as one card per step (src/app/setup/SetupForm.tsx)
// instead of one long page. When the server refuses something, the form
// opens the card the message is about. Pure, so tests can use it.

export const SETUP_STEPS = [
  { title: 'Setup key', short: 'Key' },
  { title: 'Hotel', short: 'Hotel' },
  { title: 'Floors and rooms', short: 'Rooms' },
  { title: 'Public areas', short: 'Areas' },
  { title: 'Where found items are kept', short: 'Storage' },
  { title: 'Guest support', short: 'Support' },
  { title: 'First administrator', short: 'Admin' },
] as const

/** Which card (0-based) a setup error message belongs to; null when unclear. */
export function setupErrorStep(message: string | null | undefined): number | null {
  const m = message ?? ''
  if (/setup key|SETUP_TOKEN|Setup is locked/i.test(m)) return 0
  if (/^(Hotel code|Hotel name|Address)\b/i.test(m)) return 1
  if (/\b(floors?|rooms?|room range)\b/i.test(m) && !/storage|area/i.test(m)) return 2
  if (/^Area\b/i.test(m)) return 3
  if (/storage place|place where found items/i.test(m)) return 4
  if (/contact (email|phone)/i.test(m)) return 5
  if (/administrator|username|password|^Name:/i.test(m)) return 6
  return null
}
