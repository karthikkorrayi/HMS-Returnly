import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import LoginForm from './LoginForm'

export default async function LoginPage() {
  if (await getSession()) redirect('/items')

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <span className="tag tag-lg">Returnly</span>
          <h1 className="mt-5 text-2xl font-bold">Lost property</h1>
          <p className="hint mt-1">Sign in with the username your manager gave you.</p>
        </div>
        <div className="panel p-5">
          <LoginForm />
        </div>
        <p className="hint mt-4">Forgotten your password? A manager can reset it.</p>
      </div>
    </main>
  )
}
