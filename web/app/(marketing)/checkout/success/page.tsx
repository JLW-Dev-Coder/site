import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Welcome to VLP | Virtual Launch Pro',
  description: 'Welcome to Virtual Launch Pro! Your membership is now active.',
}

export default function CheckoutSuccessPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <section className="mx-auto max-w-[77.5rem] px-4 pb-10 pt-16 md:pb-14 md:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-green-700 bg-green-800/50 px-6 py-3">
            <svg className="h-6 w-6 text-green-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-lg font-semibold text-green-300">Payment successful</span>
          </div>

          <h1 className="mb-6 text-4xl font-bold tracking-tight md:text-6xl lg:text-7xl">
            Welcome to{' '}
            <span className="bg-gradient-to-br from-amber-400 to-amber-600 bg-clip-text text-transparent">
              Virtual Launch Pro
            </span>
          </h1>

          <p className="mx-auto mb-12 max-w-3xl text-xl leading-relaxed text-slate-400 md:text-2xl">
            Your membership is now active! Access your dashboard to start using tokens, managing your profile, and connecting with the tax professional network.
          </p>

          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <Link href="/dashboard" className="inline-block rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-8 py-4 text-lg font-semibold text-slate-950 shadow-lg shadow-amber-500/25 transition-all duration-200 hover:from-amber-400 hover:to-amber-500 hover:scale-105">
              Go to Dashboard →
            </Link>
            <Link href="/features" className="inline-block rounded-lg border border-slate-700 bg-slate-900/60 px-8 py-4 text-lg font-semibold text-slate-100 transition-all duration-200 hover:bg-slate-800/80">
              Explore features
            </Link>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-[77.5rem] px-4 py-16 md:py-20">
          <div className="mx-auto max-w-3xl text-center mb-12">
            <p className="text-xs font-semibold tracking-widest text-amber-400">WHAT'S NEXT</p>
            <h2 className="mt-4 text-4xl font-extrabold md:text-5xl">Start using your new membership</h2>
            <p className="mx-auto mt-5 max-w-2xl text-base text-white/70">
              Here's how to get the most out of your Virtual Launch Pro membership.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
                <svg className="h-6 w-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h3 className="mb-3 text-xl font-bold text-white">Complete Your Profile</h3>
              <p className="text-slate-400 mb-4">
                Set up your professional profile and directory listing to start connecting with taxpayers.
              </p>
              <Link href="/account" className="text-amber-500 hover:text-amber-400 font-semibold">
                Update profile →
              </Link>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
                <svg className="h-6 w-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="mb-3 text-xl font-bold text-white">Check Your Tokens</h3>
              <p className="text-slate-400 mb-4">
                Your monthly token allocation is now available. Use them for transcript processing and tax tools.
              </p>
              <Link href="/dashboard" className="text-amber-500 hover:text-amber-400 font-semibold">
                View tokens →
              </Link>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
                <svg className="h-6 w-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="mb-3 text-xl font-bold text-white">Join the Network</h3>
              <p className="text-slate-400 mb-4">
                Connect with taxpayers looking for professional services through the network pool.
              </p>
              <Link href="/messaging" className="text-amber-500 hover:text-amber-400 font-semibold">
                Start networking →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}