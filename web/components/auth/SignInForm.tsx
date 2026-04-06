'use client'

import { useState } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

type Tab = 'email' | 'google'

export default function SignInForm() {
  const [tab, setTab] = useState<Tab>('email')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/v1/auth/magic-link/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectUri: window.location.origin }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? 'Failed to send sign-in link.')
      }
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  function handleGoogle() {
    setError(null)
    setLoading(true)
    const returnTo = encodeURIComponent(`${window.location.origin}/dashboard`)
    window.location.href = `${API_URL}/v1/auth/google/start?return_to=${returnTo}`
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-16">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-sm font-bold text-slate-950">
          VLP
        </span>
        <div className="text-center">
          <div className="font-semibold tracking-tight text-white">Virtual Launch Pro</div>
          <div className="mt-1 text-sm text-slate-400">Sign in to your account</div>
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl border border-slate-800/70 bg-slate-900/60 p-8 shadow-2xl">
        {/* Tabs */}
        <div className="mb-6 flex rounded-lg border border-slate-800 bg-slate-950/60 p-1">
          {(['email', 'google'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setError(null) }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                tab === t
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'email' ? 'Email' : 'Google'}
            </button>
          ))}
        </div>

        {/* Email tab */}
        {tab === 'email' && (
          <>
            {success ? (
              <div className="space-y-4 text-center">
                <div className="text-2xl">📬</div>
                <p className="text-sm text-slate-300">
                  Check your email — we sent a sign-in link to{' '}
                  <span className="font-semibold text-white">{email}</span>.
                </p>
                <button
                  type="button"
                  onClick={() => { setSuccess(false); setEmail(''); setError(null) }}
                  className="text-sm text-amber-400 underline underline-offset-2 hover:text-amber-300"
                >
                  Try a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleMagicLink} className="space-y-4">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-300">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 py-2.5 text-sm font-semibold text-slate-950 transition hover:from-orange-400 hover:to-amber-400 disabled:opacity-60"
                >
                  {loading ? 'Sending…' : 'Send sign-in link'}
                </button>
              </form>
            )}
          </>
        )}

        {/* Google tab */}
        {tab === 'google' && (
          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-700 bg-slate-950 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-900 disabled:opacity-60"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {loading ? 'Redirecting…' : 'Continue with Google'}
          </button>
        )}

        {/* Error */}
        {error && (
          <p className="mt-4 rounded-lg border border-red-800/50 bg-red-950/40 px-4 py-2.5 text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      {/* Footer link */}
      <p className="mt-6 text-sm text-slate-500">
        Don&apos;t have an account?{' '}
        <Link href="/contact" className="text-amber-400 underline underline-offset-2 hover:text-amber-300">
          Start here →
        </Link>
      </p>
    </div>
  )
}
