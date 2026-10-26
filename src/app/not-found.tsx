import Link from 'next/link'
import { connection } from 'next/server'
import ReturnlyIcon from '@/components/ReturnlyIcon'

// Our own "page not found". Rendered per request (connection()) so it gets
// this request's Content Security Policy nonce like every other page; the
// built-in one is prebuilt with inline styles the policy would block.
export default async function NotFound() {
  await connection()
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="brand-mark"><ReturnlyIcon name="tag" /></span>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="hint">This page doesn’t exist, or it is no longer available.</p>
      <Link href="/" className="btn btn-secondary">Back to Returnly</Link>
    </main>
  )
}
