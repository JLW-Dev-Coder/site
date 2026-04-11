'use client'

import { useEffect, useState } from 'react'
import {
  DollarSign,
  Clock,
  Landmark,
  ShieldCheck,
  Inbox,
  AlertCircle,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import StatusBadge from '../components/StatusBadge'
import { getDashboard } from '@/lib/api/dashboard'
import { getClientPoolCases, type CasePoolRecord } from '@/lib/api/client-pool'
import { getAffiliate, type AffiliateRecord } from '@/lib/api/member'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      cases: CasePoolRecord[]
      affiliate: AffiliateRecord | null
    }

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function planLabel(c: CasePoolRecord): string {
  const raw = (c.service_plan ?? c.plan ?? 'Custom') as string
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function payoutCents(c: CasePoolRecord): number {
  if (typeof c.payout_cents === 'number') return c.payout_cents
  const fee = (c.service_fee_cents ?? c.plan_fee_cents ?? 0) as number
  const platform = (c.platform_fee_cents ?? Math.round(fee * 0.12)) as number
  return Math.max(0, fee - platform)
}

function statusLabel(s: string | undefined): string {
  if (!s) return 'Pending'
  return s
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default function PayoutsClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dashboard = await getDashboard()
        if (cancelled) return
        const professionalId = dashboard.account.professional_id
        const accountId = dashboard.account.account_id

        const [casesResp, affiliate] = await Promise.all([
          professionalId
            ? getClientPoolCases({ professional_id: professionalId, limit: 50 }).catch(() => ({ cases: [] }))
            : Promise.resolve({ cases: [] as CasePoolRecord[] }),
          getAffiliate(accountId).catch(() => null),
        ])

        if (!cancelled) {
          setState({
            status: 'ready',
            cases: (casesResp as { cases: CasePoolRecord[] }).cases ?? [],
            affiliate,
          })
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not load payouts',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') return <PayoutsSkeleton />
  if (state.status === 'error') return <PayoutsFallback message={state.message} />

  const { cases, affiliate } = state

  const activeCases = cases.filter(
    (c) => c.status === 'assigned' || c.status === 'in_progress'
  )
  const completedCases = cases.filter(
    (c) => c.status === 'completed' || c.status === 'paid_out'
  )
  const pendingTotal = activeCases.reduce((sum, c) => sum + payoutCents(c), 0)
  const minThresholdCents = 50000 // $500

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Payouts</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage and track your earnings from Client Pool services.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <HeroCard>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-brand-orange" />
            <h3 className="text-xs uppercase tracking-widest text-brand-orange/70">Total Pending Payout</h3>
          </div>
          <p className="mt-4 text-4xl font-bold text-white">{centsToDollars(pendingTotal)}</p>
          <p className="mt-2 text-sm text-white/50">
            From {activeCases.length} active client engagement{activeCases.length === 1 ? '' : 's'}
          </p>
          <button
            disabled={pendingTotal < minThresholdCents}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white shadow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Request Payout
          </button>
        </HeroCard>

        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-white/30" />
            <h3 className="text-xs uppercase tracking-widest text-white/40">Payout Status</h3>
          </div>
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Lifetime Paid</span>
              <span className="text-sm font-medium text-white/70">
                {affiliate ? centsToDollars(affiliate.balance_paid ?? 0) : '$0.00'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Bank Status</span>
              <StatusBadge
                status={affiliate?.connect_status === 'active' ? 'Connected' : 'Pending'}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Minimum Threshold</span>
              <span className="text-sm font-medium text-white/70">$500</span>
            </div>
          </div>
        </div>
      </div>

      {affiliate?.connect_status !== 'active' && (
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-orange/10">
              <Landmark className="h-7 w-7 text-brand-orange" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white">Connect your bank account</h3>
              <p className="mt-1 text-sm text-white/50">
                Link your bank account via Stripe to receive Client Pool payouts directly.
              </p>
            </div>
            <a
              href="/affiliate"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90"
            >
              Connect Bank Account
            </a>
          </div>
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-sm text-emerald-400/80">
              Your bank information is encrypted and secure.
            </p>
          </div>
        </div>
      )}

      <div>
        <div className="mb-4">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Current Earnings</h3>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[--member-border] bg-[--member-card]">
          {activeCases.length === 0 ? (
            <div className="p-10 text-center text-sm text-white/40">
              No active client engagements yet. Accept cases from the Client Pool to start earning.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[--member-border]">
                  <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium">Client</th>
                  <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium">Service Plan</th>
                  <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium">Plan Fee</th>
                  <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium">Platform Fee</th>
                  <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium">Your Payout</th>
                  <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {activeCases.map((c) => {
                  const fee = (c.service_fee_cents ?? c.plan_fee_cents ?? 0) as number
                  const platform = (c.platform_fee_cents ?? Math.round(fee * 0.12)) as number
                  const payout = payoutCents(c)
                  return (
                    <tr
                      key={c.case_id}
                      className="border-b border-[--member-border] last:border-b-0 transition hover:bg-[--member-card-hover]"
                    >
                      <td className="px-5 py-3.5 font-medium text-white">
                        {c.taxpayer_name ?? c.client_name ?? '—'}
                      </td>
                      <td className="px-5 py-3.5 text-white/70">{planLabel(c)}</td>
                      <td className="px-5 py-3.5 text-white/70">{centsToDollars(fee)}</td>
                      <td className="px-5 py-3.5 text-white/70">{centsToDollars(platform)}</td>
                      <td className="px-5 py-3.5 font-medium text-brand-orange">
                        {centsToDollars(payout)}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={statusLabel(c.status)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Payout History</h3>
        {completedCases.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
              <Inbox className="h-6 w-6 text-white/20" />
            </div>
            <p className="text-sm text-white/40">
              No payout history yet — Complete your first client engagement to request a payout.
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-[--member-border]">
            {completedCases.map((c) => (
              <div key={c.case_id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-white">
                    {c.taxpayer_name ?? c.client_name ?? '—'}
                  </p>
                  <p className="mt-0.5 text-xs text-white/40">
                    {planLabel(c)} · {statusLabel(c.status)}
                  </p>
                </div>
                <p className="text-sm font-medium text-brand-orange">
                  {centsToDollars(payoutCents(c))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PayoutsSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Payouts</h1>
        <p className="mt-1 text-sm text-white/50">Loading earnings…</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-40 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        <div className="h-40 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      </div>
      <div className="h-48 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
    </div>
  )
}

function PayoutsFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Payouts</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage and track your earnings from Client Pool services.
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
