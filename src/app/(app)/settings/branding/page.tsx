import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { staffPath } from '@/lib/staff-paths'
import { authBaseURL } from '@/lib/better-auth/instance'
import { withStaff } from '@/lib/db'
import { loadBranding, logoPath, MIN_CONTRAST } from '@/lib/branding'
import InlineAction from '@/components/InlineAction'
import { saveBrandingAction } from './actions'
import LogoUploader from './LogoUploader'

// Managers: the hotel's web address, email colour, welcome line and logo.
export default async function BrandingPage() {
  const { staff, property } = await requireSession(['manager'])
  const b = await withStaff(staff.user_id, loadBranding)
  const origin = authBaseURL().replace(/\/+$/, '')

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href={staffPath(property.slug, '/settings')} className="text-sm font-semibold text-teal">← Settings</Link>
      <div>
        <h1 className="text-2xl font-bold">Branding</h1>
        <p className="hint mt-1">How {b.name} appears on its guest page and in emails to customers. Emails always come from Foundora’s address, with your hotel’s name.</p>
      </div>

      <section className="panel p-4 sm:p-5">
        <h2 className="mb-1 text-lg font-semibold">Logo</h2>
        <LogoUploader current={b.logo_key ? logoPath(b.slug, b.logo_version) : null} />
      </section>

      <section className="panel p-4 sm:p-5">
        <h2 className="mb-1 text-lg font-semibold">Address, colour and welcome line</h2>
        <p className="hint mb-4">
          Your guest page: <a className="break-all font-semibold text-teal underline" href={`/h/${b.slug}`}>{origin}/h/{b.slug}</a>
        </p>
        {/* Submitted by hand, so typed values stay if something is refused. */}
        <InlineAction action={saveBrandingAction} submitLabel="Save branding" pendingLabel="Saving…" variant="primary" okText="Saved">
          <div className="w-full space-y-4">
          <div>
            <label htmlFor="slug" className="label">Web address</label>
            <div className="flex items-center gap-1">
              <span className="text-muted">/h/</span>
              <input id="slug" name="slug" className="field" defaultValue={b.slug} maxLength={40} required
                pattern="[a-z0-9]([a-z0-9\-]{1,38}[a-z0-9])" autoCapitalize="none" spellCheck={false} />
            </div>
            <p className="hint mt-1">Lower-case letters, digits and dashes. Changing it changes the address on posters and QR codes; links already in customers’ emails keep working.</p>
          </div>
          <div>
            <label htmlFor="colour" className="label">Email colour <span className="font-normal text-muted">(optional)</span></label>
            <div className="flex items-center gap-2">
              <input id="colour" name="colour" className="field sm:w-40" defaultValue={b.brand_colour ?? ''} placeholder="#0b6468" maxLength={7} pattern="#[0-9a-fA-F]{6}" />
              {b.brand_colour && <span aria-hidden="true" className="h-9 w-9 rounded-lg border border-line" style={{ background: b.brand_colour }} />}
            </div>
            <p className="hint mt-1">Used for the strip and button in emails. It must be dark enough for white text (contrast {MIN_CONTRAST}:1); empty uses Foundora’s teal.</p>
          </div>
          <div>
            <label htmlFor="intro" className="label">Welcome line <span className="font-normal text-muted">(optional)</span></label>
            <textarea id="intro" name="intro" className="field min-h-20" defaultValue={b.brand_intro ?? ''} maxLength={300}
              placeholder="e.g. Thank you for staying with us. Our team checks every report personally." />
            <p className="hint mt-1">Shown in the “report received” email. Plain text, up to 300 characters.</p>
          </div>
          </div>
        </InlineAction>
      </section>
    </div>
  )
}
