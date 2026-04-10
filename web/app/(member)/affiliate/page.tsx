import type { Metadata } from 'next'
import {
  Link2,
  Copy,
  DollarSign,
  Clock,
  Landmark,
  ShieldCheck,
  Inbox,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'

export const metadata: Metadata = { title: 'Affiliate' }

/* ── page ──────────────────────────────────────────────────────── */

export default function AffiliatePage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Affiliate Program</h1>
        <p className="mt-1 text-sm text-white/50">
          Earn commissions by referring new customers to our platform.
        </p>
      </div>

      {/* Referral Link hero card */}
      <HeroCard>
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-brand-orange" />
            <h2 className="text-lg font-semibold text-white">Your Referral Link</h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 overflow-hidden rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
              <span className="block truncate font-mono text-sm text-white/70">
                https://virtuallaunch.pro/ref/XXXXXX
              </span>
            </div>
            <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90">
              <Copy className="h-4 w-4" />
              Copy
            </button>
          </div>

          <div className="rounded-lg border border-brand-orange/20 bg-brand-orange/5 px-4 py-3">
            <p className="text-sm text-white/60">
              Share this link. Earn <span className="font-medium text-brand-orange">20% commission</span> on every purchase your referrals make, for life.
            </p>
          </div>
        </div>
      </HeroCard>

      {/* Earnings Summary — 2-column grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Available to Withdraw */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-white/30" />
            <h3 className="text-xs uppercase tracking-widest text-white/40">Available to Withdraw</h3>
          </div>
          <p className="mt-4 text-4xl font-bold text-brand-orange">$0.00</p>
          <button className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white shadow transition hover:opacity-90">
            Request Payout
          </button>
        </div>

        {/* Total Earned and Paid */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-white/30" />
            <h3 className="text-xs uppercase tracking-widest text-white/40">Total Earned and Paid</h3>
          </div>
          <p className="mt-4 text-4xl font-bold text-white">$0.00</p>
          <button className="mt-5 inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10">
            View History
          </button>
        </div>
      </div>

      {/* Bank Account */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-orange/10">
            <Landmark className="h-7 w-7 text-brand-orange" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">Connect your bank account</h3>
            <p className="mt-1 text-sm text-white/50">
              Link your bank account via Stripe to receive affiliate commission payouts directly.
            </p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90">
            Connect Bank Account
          </button>
        </div>
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p className="text-sm text-emerald-400/80">
            Your bank information is encrypted and secure.
          </p>
        </div>
      </div>

      {/* Commission History */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Commission History</h3>
        <div className="mt-8 flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
            <Inbox className="h-6 w-6 text-white/20" />
          </div>
          <p className="text-sm text-white/40">
            No commissions yet &mdash; Share your referral link to start earning.
          </p>
        </div>
      </div>
    </div>
  )
}
