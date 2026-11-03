// Customer email templates: one set for every hotel, filled from the report
// and the hotel's record. Plain JavaScript (no build step) so the email job
// can run it with plain `node`. Every value is escaped; hotels never supply
// HTML. Each email has an HTML and a plain-text version.
//
// What an email may contain: the hotel's name/branding and contact details,
// the reference, the item name, the date sent, the status, and the private
// tracking link. Never the customer's name, booking ID, description or
// staff messages (a mistyped address must not leak them).

export const TEMPLATES = ['received', 'contact_required', 'staff_message', 'under_review', 'matched', 'closed', 'resolved']

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const DEFAULT_COLOUR = '#0b6468'
const colourOf = (c) => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c : DEFAULT_COLOUR)
const dateOf = (iso) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(iso))

/** Guest-facing status shown in each email (same words as the tracking page). */
export const STATUS_LABEL = {
  received: 'Submitted',
  under_review: 'Under review',
  contact_required: 'Contact required',
  staff_message: null,
  matched: 'Matched',
  resolved: 'Resolved',
  closed: 'Closed',
}

function wording(t, found, hotel, ref) {
  switch (t) {
    case 'received':
      return found
        ? { subject: `Thank you – found item report ${ref} – ${hotel}`,
            heading: 'Thank you for reporting a found item',
            lines: [`${hotel} has received your report.`, 'If you haven’t handed the item in yet, please take it to the hotel reception. You won’t be put in touch with the owner.'] }
        : { subject: `Your lost item report ${ref} – ${hotel}`,
            heading: 'We’ve received your report',
            lines: [`${hotel} will check your report against the items it holds.`, 'This doesn’t mean your item has been found yet. We’ll email you when there’s an update.'] }
    case 'under_review':
      return { subject: `Your report is being reviewed – ${ref}`, heading: 'Your report is being reviewed',
        lines: [`A member of the ${hotel} team is now looking into your report.`] }
    case 'contact_required':
      return { subject: `${hotel} needs more information – ${ref}`, heading: 'The hotel needs a little more information',
        lines: ['Please open your report and answer the question from the hotel team, so they can continue.'] }
    case 'staff_message':
      return { subject: `New message from ${hotel} – ${ref}`, heading: 'You have a new message',
        lines: [`The ${hotel} team has sent you a message about your report. For your privacy, it is shown on your report page, not in this email.`] }
    case 'matched':
      // Never queued for found reports (the database doesn't send it); kept neutral anyway.
      return found
        ? { subject: `Update on your report ${ref}`, heading: 'There’s an update on your report', lines: [`${hotel} has updated your report.`] }
        : { subject: `${hotel} may have found your item – ${ref}`, heading: 'Good news: the hotel thinks it has your item',
            lines: ['The hotel team will arrange collection or posting with you. Please bring photo ID that matches your booking.'] }
    case 'closed':
      return { subject: `Update on your report ${ref}`, heading: 'Your report has been closed',
        lines: found ? ['This report is now closed. Thank you for letting the hotel know.']
          : ['The hotel couldn’t match your description to anything it holds. Your report page may have a message explaining more.'] }
    case 'resolved':
      return found
        ? { subject: `Thank you – report ${ref} resolved`, heading: 'Your report is resolved', lines: ['The hotel has the item. Thank you for handing it in.'] }
        : { subject: `Your report ${ref} is resolved`, heading: 'Your report is resolved', lines: ['This report is now resolved. If something else is missing, you can send a new report.'] }
    default:
      throw new Error(`unknown email template: ${t}`)
  }
}

/**
 * @param {{ template: string, reportType: 'lost'|'found', reference: string, itemName: string,
 *           createdAt: string, trackUrl: string,
 *           hotel: { name: string, contactEmail?: string|null, contactPhone?: string|null,
 *                    supportHours?: string|null, logoUrl?: string|null, colour?: string|null } }} d
 * @returns {{ subject: string, html: string, text: string }}
 */
export function renderEmail(d) {
  if (!TEMPLATES.includes(d.template)) throw new Error(`unknown email template: ${d.template}`)
  const found = d.reportType === 'found'
  const hotel = d.hotel.name
  const w = wording(d.template, found, hotel, d.reference)
  const status = STATUS_LABEL[d.template]
  const colour = colourOf(d.hotel.colour)
  const contact = [d.hotel.contactPhone, d.hotel.contactEmail, d.hotel.supportHours].filter(Boolean)
  const kind = found ? 'Found item' : 'Lost item'
  const sent = dateOf(d.createdAt)

  const text = [
    `${hotel} · Lost & found`,
    '',
    w.heading,
    '',
    ...w.lines,
    '',
    `Reference: ${d.reference}`,
    `Report: ${kind} – ${d.itemName}`,
    `Sent: ${sent}`,
    ...(status ? [`Status: ${status}`] : []),
    '',
    `View your report and reply to the hotel: ${d.trackUrl}`,
    'Keep this link private: anyone with it can see your report’s status and messages.',
    '',
    ...(contact.length ? [`Contact ${hotel}: ${contact.join(' · ')}`, ''] : []),
    `Sent by Foundora on behalf of ${hotel}. This inbox isn’t monitored; please use the link above to reply.`,
  ].join('\n')

  const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#56656f;font-size:14px">${esc(k)}</td><td style="padding:4px 0;font-size:14px;color:#17252e">${esc(v)}</td></tr>`
  const logo = /^https:\/\//.test(d.hotel.logoUrl ?? '')
    ? `<img src="${esc(d.hotel.logoUrl)}" alt="${esc(hotel)}" height="48" style="display:block;height:48px;max-width:200px;margin-bottom:8px">`
    : ''
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(w.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f7;font-family:Arial,Helvetica,sans-serif;color:#17252e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${colour};height:6px;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:24px 24px 8px">${logo}<p style="margin:0;font-size:18px;font-weight:bold">${esc(hotel)}</p><p style="margin:2px 0 0;font-size:13px;color:#56656f">Lost &amp; found</p></td></tr>
<tr><td style="padding:8px 24px 0"><h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${esc(w.heading)}</h1>
${w.lines.map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.5">${esc(l)}</p>`).join('\n')}</td></tr>
<tr><td style="padding:8px 24px"><p style="margin:0;font-size:13px;color:#56656f">Your reference</p><p style="margin:2px 0 0;font-size:24px;font-weight:bold;letter-spacing:1px;font-family:Consolas,Menlo,monospace">${esc(d.reference)}</p></td></tr>
<tr><td style="padding:8px 24px"><table role="presentation" cellpadding="0" cellspacing="0">${row('Report', `${kind} – ${d.itemName}`)}${row('Sent', sent)}${status ? row('Status', status) : ''}</table></td></tr>
<tr><td style="padding:16px 24px"><a href="${esc(d.trackUrl)}" style="display:inline-block;background:${colour};color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 20px;border-radius:8px">View your report</a>
<p style="margin:10px 0 0;font-size:12px;color:#56656f">Keep this link private: anyone with it can see your report’s status and messages.</p></td></tr>
${contact.length ? `<tr><td style="padding:0 24px 16px;font-size:13px;color:#56656f">Contact ${esc(hotel)}: ${contact.map(esc).join(' · ')}</td></tr>` : ''}
<tr><td style="padding:16px 24px;border-top:1px solid #d8dee2;font-size:12px;color:#56656f">Sent by Foundora on behalf of ${esc(hotel)}. This inbox isn’t monitored; please use the link above to reply.</td></tr>
</table></td></tr></table></body></html>`

  return { subject: w.subject, html, text }
}
