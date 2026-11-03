// The customer's email address: checked here for a quick message on screen,
// and again by the database (submit_customer_report, migration 016) with the
// same rule. Not verified by sending a code, by decision: the customer
// confirms it on screen instead. No Next.js imports, so tests can run it.

// Mirrors the database check. Deliberately plain: letters, digits and the
// usual . _ % + ' - before the @; a domain with a dot and a 2+ letter ending.
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

export function normaliseEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

export function isValidEmail(raw: unknown): boolean {
  const e = normaliseEmail(raw)
  return e.length > 0 && e.length <= 254 && EMAIL.test(e) && !e.includes('..')
}

/** Common slips worth a second look before the customer confirms. */
const TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gamil.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'yahoo.co': 'yahoo.com',
  'icloud.co': 'icloud.com',
}

export function emailTypoHint(raw: unknown): string | null {
  const domain = normaliseEmail(raw).split('@')[1]
  return domain && TYPOS[domain] ? `Did you mean …@${TYPOS[domain]}?` : null
}

/** The confirmation question shown before a report is sent. */
export const CONFIRM_EMAIL_TEXT =
  'Is this your correct email address? We will send your reference ID and future status updates to this email.'
