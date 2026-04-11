'use client'

import { useEffect, useState } from 'react'
import {
  Link2,
  Copy,
  DollarSign,
  Clock,
  Landmark,
  ShieldCheck,
  Inbox,
  AlertCircle,
  Check,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import { getDashboard } from '@/lib/api/dashboard'
import {
  getAffiliate,
  getAffiliateEvents,
  type AffiliateRecord,
  type AffiliateEventRow,
} from '@/lib/api/member'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; affiliate: AffiliateRecord; events: AffiliateEventRow[] }

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AffiliateClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dashboard = await getDashboard()
        if (cancelled) return
        const accountId = dashboard.account.account_id
        const [affiliate, events] = await Promise.all([
          getAffiliate(accountId),
          getAffiliateEvents(accountId).catch(() => [] as AffiliateEventRow[]),
        ])
        if (!cancelled) setState({ status: 'ready', affiliate, events })
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not load affiliate',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') return <AffiliateSkeleton />
  if (state.status === 'error') return <AffiliateFallback message={state.message} />

  const { affiliate, events } = state

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(affiliate.referral_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  const handleConnect = async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? ''}/v1/affiliates/connect/onboard`,
        { method: 'POST', credentials: 'include' }
      )
      const data = await res.json().catch(() => ({}))
      if (data?.onboard_url) {
        window.location.href = data.onboard_url
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Affiliate Program</h1>
        <p className="mt-1 text-sm text-white/50">
          Earn commissions by referring new customers to our platform.
        </p>
      </div>

      <HeroCard>
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-brand-orange" />
            <h2 className="text-lg font-semibold text-white">Your Referral Link</h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 overflow-hidden rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
              <span className="block truncate font-mono text-sm text-white/70">
                {affiliate.referral_url}
              </span>
            </div>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="rounded-lg border border-brand-orange/20 bg-brand-orange/5 px-4 py-3">
            <p className="text-sm text-white/60">
              Share this link. Earn{' '}
              <span className="font-medium text-brand-orange">20% commission</span> on every
              purchase your referrals make, for life.
            </p>
          </div>
        </div>
      </HeroCard>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-white/30" />
            <h3 className="text-xs uppercase tracking-widest text-white/40">Available to Withdraw</h3>
          </div>
          <p className="mt-4 text-4xl font-bold text-brand-orange">
            {centsToDollars(affiliate.balance_pending ?? 0)}
          </p>
          <button
            disabled={affiliate.connect_status !== 'active' || (affiliate.balance_pending ?? 0) < 1000}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white shadow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Request Payout
          </button>
        </div>

        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-white/30" />
            <h3 className="text-xs uppercase tracking-widest text-white/40">Total Earned and Paid</h3>
          </div>
          <p className="mt-4 text-4xl font-bold text-white">
            {centsToDollars(affiliate.balance_paid ?? 0)}
          </p>
          <p className="mt-5 text-sm text-white/40">
            {affiliate.referred_count ?? 0} referred account
            {affiliate.referred_count === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-orange/10">
            <Landmark className="h-7 w-7 text-brand-orange" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">
              {affiliate.connect_status === 'active'
                ? 'Bank account connected'
                : 'Connect your bank account'}
            </h3>
            <p className="mt-1 text-sm text-white/50">
              {affiliate.connect_status === 'active'
                ? 'Your Stripe Connect account is linked and ready to receive payouts.'
                : 'Link your bank account via Stripe to receive affiliate commission payouts directly.'}
            </p>
          </div>
          {affiliate.connect_status !== 'active' && (
            <button
              onClick={handleConnect}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90"
            >
              Connect Bank Account
            </button>
          )}
        </div>
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p className="text-sm text-emerald-400/80">
            Your bank information is encrypted and secure.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Commission History</h3>
        {events.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
              <Inbox className="h-6 w-6 text-white/20" />
            </div>
            <p className="text-sm text-white/40">
              No commissions yet — Share your referral link to start earning.
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-[--member-border]">
            {events.map((evt) => (
              <div key={evt.event_id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-white">
                    {(evt.platform ?? 'VLP').toUpperCase()} commission
                  </p>
                  <p className="mt-0.5 text-xs text-white/40">{formatDate(evt.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-brand-orange">
                    {centsToDollars(evt.commission_amount_cents ?? 0)}
                  </p>
                  <p className="mt-0.5 text-xs text-white/40 capitalize">{evt.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AffiliateSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Affiliate Program</h1>
        <p className="mt-1 text-sm text-white/50">Loading affiliate data…</p>
      </div>
      <div className="h-40 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-40 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        <div className="h-40 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      </div>
    </div>
  )
}

function AffiliateFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Affiliate Program</h1>
        <p className="mt-1 text-sm text-white/50">
          Earn commissions by referring new customers.
        </p>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Could not load live data</p>
          <p className="mt-1 text-amber-200/70">{message}</p>
        </div>
      </div>
    </div>
  )
}
