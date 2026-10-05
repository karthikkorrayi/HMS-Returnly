import Link from 'next/link'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import DashboardPreview from '@/components/DashboardPreview'

const STEPS = [
  {
    icon: 'tag',
    title: '01 / Log & protect',
    description: 'Record where an item was found and store it safely. Sensitive items are kept secure, without photos.',
  },
  {
    icon: 'search',
    title: '02 / Match & contact',
    description: 'The front desk matches belongings to a reservation. Guest contact stays in your hotel’s PMS.',
  },
  {
    icon: 'shield',
    title: '03 / Return with confidence',
    description: 'Record collection or posting with the right checks and witnesses. Every step has a custody record.',
  },
] as const

export default function Home() {
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
          <Link href="/login" className="btn btn-primary">
            Staff sign in <ReturnlyIcon name="arrow" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
        <section
          className="overview-hero relative overflow-hidden rounded-3xl px-6 py-8 sm:px-10 sm:py-10"
          aria-labelledby="overview-title"
        >
          <div className="relative z-10 max-w-2xl">
            <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-teal-dark">
              <span className="size-2 rounded-full bg-teal" />
              A little care. A happy reunion.
            </p>
            <h1 id="overview-title" className="max-w-xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
              Left behind.<br />
              <span className="text-teal">Never forgotten.</span>
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-muted">
              From the first found item to the final handover. Give your hotel
              team one clear place to keep belongings safe and get them back
              to their guests.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/login?next=/items/new" className="btn btn-primary">
                <ReturnlyIcon name="plus" />Log a found item
              </Link>
              <a href="#workspace-preview" className="btn btn-secondary">
                Explore the preview <ReturnlyIcon name="arrow" />
              </a>
            </div>
            <p className="mt-3 text-xs text-muted">
              Staff sign-in required to log or manage real items.
            </p>
          </div>
          <div className="hero-tag hidden lg:flex" aria-hidden="true">
            <span className="hero-tag-hole" />
            <ReturnlyIcon name="tag" className="!size-12" />
            <span className="mt-5 text-3xl font-bold tracking-tight">
              Found.<br />Kept safe.<br />Returned.
            </span>
            <span className="mt-6 border-t border-tag-edge pt-3 text-xs font-semibold uppercase tracking-widest">
              Every item has a story.
            </span>
          </div>
        </section>

        <DashboardPreview />

        <section
          className="mt-10 grid gap-5 border-t border-line pt-8 sm:grid-cols-3"
          aria-label="How Returnly works"
        >
          {STEPS.map((step) => (
            <div key={step.title} className="flex gap-3">
              <span className="mt-1 text-teal"><ReturnlyIcon name={step.icon} /></span>
              <div>
                <h2 className="text-sm font-bold">{step.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </section>
      </main>

      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 pb-8 pt-4 text-xs text-muted sm:px-8">
        <span>Returnly · A thoughtful home for lost property.</span>
        <span className="flex items-center gap-2">
          <ReturnlyIcon name="shield" className="!size-4" />
          Hotel records are available only to signed-in staff.
        </span>
      </footer>
    </div>
  )
}
