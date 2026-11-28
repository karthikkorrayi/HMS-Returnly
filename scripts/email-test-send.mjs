#!/usr/bin/env node
// Sends ONE plain test email through Resend, to check an API key and the
// sender domain from your own computer. It does not touch any database and is
// not used by the app.
//
//   RESEND_API_KEY=… npm run email:test-send -- --to you@example.com
//
// Variables (values are never printed):
//   RESEND_API_KEY   the Resend API key to test (required)
//   EMAIL_FROM       sender address (default notifications@foundora.co.uk)
//   EMAIL_FROM_NAME  sender name (default "Foundora")
//
// "accepted" means Resend took the email; whether it was DELIVERED shows in
// Resend → Emails (and, once webhooks are set up, in the app).
// Exit code: 0 accepted, 1 refused/failed, 2 set-up problem.
import { randomUUID } from 'node:crypto'
import { sendViaResend } from './email/resend.mjs'

const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

const HELP = {
  config: 'Resend refused it: check the key is correct and active, and that the sender domain is verified in Resend → Domains.',
  quota: 'The Resend sending quota is used up for now; try again after it resets.',
  rate: 'Too many requests this second; wait a moment and try again.',
  retry: 'A temporary problem (network, timeout or Resend); try again in a minute.',
  permanent: 'Resend refused this email (often the recipient address); check the --to address.',
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const i = argv.indexOf('--to')
  const to = (i >= 0 ? argv[i + 1] ?? '' : '').trim().toLowerCase()
  const key = (env.RESEND_API_KEY || '').trim()
  const from = (env.EMAIL_FROM || 'notifications@foundora.co.uk').trim().toLowerCase()
  const name = (env.EMAIL_FROM_NAME || 'Foundora').trim().slice(0, 40)
  const problems = []
  if (!EMAIL.test(to)) problems.push('give the recipient with --to you@example.com')
  if (!key) problems.push('RESEND_API_KEY is not set')
  else if (!/^re_[A-Za-z0-9_]{8,}$/.test(key)) problems.push('RESEND_API_KEY does not look like a Resend API key (re_…)')
  if (!EMAIL.test(from)) problems.push('EMAIL_FROM is not a valid address')
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); return 2 }

  const sentAt = new Date().toISOString()
  console.log(`Sending one test email from ${from} to ${to} (key: set, value hidden)…`)
  const res = await sendViaResend({
    apiKey: key, from: { email: from, name: `${name} test` }, to, tag: 'test',
    subject: `Foundora test email ${sentAt}`,
    text: `This is a test email from the Foundora email setup, sent at ${sentAt}.\nNo action is needed.`,
    html: `<p>This is a test email from the Foundora email setup, sent at ${sentAt}.</p><p>No action is needed.</p>`,
    idempotencyKey: `foundora-test-${randomUUID()}`,
  })
  if (res.ok) {
    console.log(`✓ accepted by Resend (email id ${res.messageId || 'not returned'}).`)
    console.log('  Next: Resend → Emails shows whether it was Delivered or Bounced; then check the inbox (and spam).')
    return 0
  }
  console.error(`✗ not accepted: ${res.code}`)
  console.error(`  ${HELP[res.kind] ?? 'Unexpected answer from Resend.'}`)
  return res.kind === 'config' ? 2 : 1
}

process.exitCode = await main()
