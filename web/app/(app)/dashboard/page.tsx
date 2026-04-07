import type { Metadata } from 'next'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import OnboardingPrompt from '@/components/app/OnboardingPrompt'
import { getDashboardSummary } from '@/lib/api/client'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  let summary
  try { summary = await getDashboardSummary() } catch { summary = { tokensRemaining: 0, tokensTotal: 0, upcomingBookings: 0, openTickets: 0, membership: 'free', renewalDate: 'N/A' } }

  const isFree = summary.membership === 'free'

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">
          Welcome back. Here&apos;s what&apos;s happening with your practice.
        </p>
      </div>

      {/* Upgrade prompt for Free members */}
      {isFree && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
          <div className="text-sm font-semibold text-amber-300">You&apos;re on the Free plan</div>
          <p className="mt-1 text-sm text-slate-300">
            Upgrade to Starter, Scale, or Advanced to access the taxpayer network, transcript tokens, and booking infrastructure.
          </p>
          <Link
            href="/pricing"
            className="mt-3 inline-block rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
          >
            View plans →
          </Link>
        </div>
      )}

      {/* Onboarding prompt (dismissible, client-side) */}
      <OnboardingPrompt />

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Tokens Remaining
          </div>
          <div className="mt-2 text-3xl font-bold text-white">
            {summary.tokensRemaining.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-500">of {summary.tokensTotal.toLocaleString()} monthly</div>
        </Card>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Upcoming Bookings
          </div>
          <div className="mt-2 text-3xl font-bold text-white">{summary.upcomingBookings}</div>
          <div className="mt-1 text-xs text-slate-500">next 7 days</div>
        </Card>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Open Support Tickets
          </div>
          <div className="mt-2 text-3xl font-bold text-white">{summary.openTickets}</div>
          <div className="mt-1 text-xs text-slate-500">
            {summary.openTickets === 0 ? 'All clear' : 'Awaiting response'}
          </div>
        </Card>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Membership
          </div>
          <div className="mt-2 text-lg font-bold text-white capitalize">{summary.membership}</div>
          <div className="mt-1 text-xs text-slate-500">
            Renews {summary.renewalDate}
          </div>
        </Card>
      </div>

      {/* Quick links */}
      <div>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Quick Links
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              label: 'Profile Setup',
              href: '/onboarding',
              desc: 'Build your Tax Monitor network profile',
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              ),
            },
            {
              label: 'Account Settings',
              href: '/account',
              desc: 'Manage profile and preferences',
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              ),
            },
            {
              label: 'Calendar',
              href: '/calendar',
              desc: 'View and manage your schedule',
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              ),
            },
            {
              label: 'Receipts',
              href: '/receipts',
              desc: 'Download invoices and receipts',
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              ),
            },
            {
              label: 'Support',
              href: '/support',
              desc: 'Get help from our team',
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              ),
            },
            {
              label: 'Token Usage',
              href: '/token-usage',
              desc: 'Monitor your AI token consumption',
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              ),
            },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="group rounded-xl border border-slate-800/60 bg-slate-950/40 p-4 transition hover:border-slate-700 hover:bg-slate-900"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100 group-hover:text-white">
                <svg
                  className="h-5 w-5 shrink-0 text-slate-400 transition group-hover:text-amber-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  {link.icon}
                </svg>
                {link.label}
              </div>
              <div className="mt-1 text-xs text-slate-400">{link.desc}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
