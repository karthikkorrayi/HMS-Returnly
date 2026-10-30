import Link from 'next/link'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { withAnon } from '@/lib/db'
import { isSetUp } from '@/lib/setup'
import { publicContacts, type PublicContact } from '@/lib/hotel-config'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import EnquiryChat from '@/components/enquiry/EnquiryChat'
import { listHotels } from '@/lib/requests/public-actions'
import { hotelToday } from '@/lib/format'

// Public, no sign-in. Shows nothing from the hotel's records: customers send
// an enquiry, staff check it, and the customer follows it with a reference.

const STEPS = [
  {
    icon: 'search',
    title: 'Tell us what’s missing',
    description: 'Describe the item in your own words, with your name and booking ID.',
  },
  {
    icon: 'shield',
    title: 'We check our records',
    description: 'A member of staff compares your description with the items we hold. Nothing is confirmed automatically.',
  },
  {
    icon: 'check',
    title: 'Follow it with your reference',
    description: 'See updates, answer questions from the team, and arrange collection or posting.',
  },
] as const

export default async function Home() {
  // The hotel list comes from the database on every request (never at build time).
  await connection()
  // A brand-new installation goes to first-time setup. (If the database can't
  // be asked, the page shows as before: "Enquiries aren't available".)
  if ((await isSetUp(withAnon).catch(() => true)) === false) redirect('/setup')
  const hotels = await listHotels()
  // The hotel's phone, email and hours for guests (entered at setup, edited
  // under Settings). Never blocks the page if it can't be read.
  const contacts: PublicContact[] = await withAnon(publicContacts).catch((e) => {
    console.error('public contacts failed', e)
    return []
  })
  const names = new Map(hotels.map((h) => [h.inn_code, h.name]))
  const shown = contacts.filter((c) => c.contact_phone || c.contact_email || c.support_hours || c.support_note)
  const today = hotelToday()

  return (
    <div className="overview-shell">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" aria-label="Returnly home" className="flex items-center gap-3">
            <span className="brand-mark"><ReturnlyIcon name="tag" /></span>
            <span className="text-xl font-bold tracking-tight">
              Returnly
              <span className="hidden pl-4 text-sm font-normal tracking-normal text-muted sm:inline">
                Hotel lost &amp; found
              </span>
            </span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-2 sm:gap-3">
            <Link href="/track" className="btn btn-secondary">Check an enquiry</Link>
            <Link href="/login" className="hidden text-sm font-semibold text-teal sm:inline">Staff sign in</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-8 sm:py-12">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-8">
          <section className="overview-hero relative overflow-hidden rounded-3xl px-6 py-6 sm:px-10 sm:py-10" aria-labelledby="overview-title">
            <h1 id="overview-title" className="text-2xl font-bold leading-tight tracking-tight sm:text-5xl">
              Left something behind?
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
              Tell us what you’ve lost and we’ll check it against the items our team has found. You’ll get a reference
              to follow your enquiry.
            </p>
            <ol className="mt-8 hidden space-y-5 lg:block">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-teal text-sm font-bold text-white" aria-hidden>
                    {i + 1}
                  </span>
                  <div>
                    <h2 className="font-bold">{step.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm lg:mt-8">
              Already sent one?{' '}
              <Link href="/track" className="font-semibold text-teal underline">Check its status</Link>
            </p>
          </section>

          <section aria-labelledby="enquiry-title">
            <h2 id="enquiry-title" className="sr-only">Send a lost property enquiry</h2>
            {hotels.length === 0 ? (
              <div className="panel p-6" role="alert">
                <p className="font-semibold">Enquiries aren’t available right now.</p>
                <p className="hint mt-1">Please contact the hotel directly.</p>
              </div>
            ) : (
              <EnquiryChat hotels={hotels} today={today} />
            )}
            {shown.length > 0 && (
              <div className="panel mt-4 space-y-3 p-5">
                <h3 className="font-semibold">Prefer to talk to someone?</h3>
                {shown.map((c) => (
                  <div key={c.inn_code} className="text-sm">
                    {shown.length > 1 && <p className="font-semibold">{names.get(c.inn_code) ?? c.inn_code}</p>}
                    {c.contact_phone && (
                      <p>Phone: <a className="font-semibold text-teal underline" href={`tel:${c.contact_phone.replace(/[^0-9+]/g, '')}`}>{c.contact_phone}</a></p>
                    )}
                    {c.contact_email && (
                      <p>Email: <a className="font-semibold text-teal underline" href={`mailto:${c.contact_email}`}>{c.contact_email}</a></p>
                    )}
                    {c.support_hours && <p className="text-muted">Hours: {c.support_hours}</p>}
                    {c.support_note && <p className="text-muted">{c.support_note}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Phones: how it works goes after the form, so the form is reachable first. */}
          <section aria-label="How it works" className="lg:hidden">
            <ol className="space-y-4">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-teal text-sm font-bold text-white" aria-hidden>
                    {i + 1}
                  </span>
                  <div>
                    <h2 className="font-bold">{step.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>

      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 pb-8 pt-4 text-xs text-muted sm:px-8">
        <span>Returnly · Hotel lost property enquiries</span>
        <span className="flex items-center gap-2">
          <ReturnlyIcon name="shield" className="!size-4" />
          We only use your details to handle this enquiry.
        </span>
        <Link href="/login" className="font-semibold text-teal sm:hidden">Staff sign in</Link>
      </footer>
    </div>
  )
}
