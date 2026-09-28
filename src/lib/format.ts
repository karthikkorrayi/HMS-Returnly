// Dates are shown in hotel time (UK), whatever timezone the device is in.
const TZ = 'Europe/London'

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}

// Today's date in hotel time, as YYYY-MM-DD.
export function hotelToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}
