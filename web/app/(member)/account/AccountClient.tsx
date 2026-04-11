'use client'

import { useEffect, useState } from 'react'
import {
  Mail,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  KeyRound,
  Smartphone,
  Monitor,
  ChevronRight,
  Crown,
  Check,
  ArrowRight,
  AlertCircle,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import StatusBadge from '../components/StatusBadge'
import { getDashboard } from '@/lib/api/dashboard'
import { getAccount, getMembershipByAccount, type AccountRow, type MembershipRow } from '@/lib/api/member'
import type { DashboardPayload } from '@/lib/api/types'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      dashboard: DashboardPayload
      account: AccountRow | null
      membership: MembershipRow | null
    }

const TIER_FEATURES: Record<string, { label: string; price: string; features: string[] }> = {
  vlp_free: {
    label: 'Listed',
    price: '$0/month',
    features: ['Basic directory listing', 'No token allocation', 'Limited access'],
  },
  vlp_starter: {
    label: 'Active',
    price: '$79/month',
    features: [
      '2 transcript tokens / month',
      '5 game tokens / month',
      'Calendar bookings',
      'Standard support',
    ],
  },
  vlp_scale: {
    label: 'Featured',
    price: '$199/month',
    features: [
      '5 transcript tokens / month',
      '15 game tokens / month',
      'Unlimited calendar bookings',
      'Priority support',
      'Featured directory listing',
    ],
  },
  vlp_advanced: {
    label: 'Premier',
    price: '$399/month',
    features: [
      '10 transcript tokens / month',
      '40 game tokens / month',
      'Unlimited calendar bookings',
      'Priority phone support',
      'Premier directory listing',
      'Client Pool access',
    ],
  },
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function AccountClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dashboard = await getDashboard()
        if (cancelled) return
        const accountId = dashboard.account.account_id
        const [account, membership] = await Promise.all([
          getAccount(accountId).catch(() => null),
          getMembershipByAccount(accountId).catch(() => null),
        ])
        if (!cancelled) setState({ status: 'ready', dashboard, account, membership })
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not load account',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') return <AccountSkeleton />
  if (state.status === 'error') return <AccountFallback message={state.message} />

  const { dashboard, account, membership } = state
  const planKey = (dashboard.account.plan_key ?? 'vlp_free').replace(/_(monthly|yearly)$/, '')
  const tierInfo = TIER_FEATURES[planKey] ?? TIER_FEATURES.vlp_free

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Account</h1>
        <p className="mt-1 text-sm text-white/50">Manage your account and membership.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Account Details</h3>
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Mail className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Email</p>
                <p className="text-sm font-medium text-white">{dashboard.account.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <CalendarDays className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Account Created</p>
                <p className="text-sm font-medium text-white">
                  {formatDate(dashboard.account.member_since)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <CheckCircle2 className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Account Status</p>
                <div className="mt-0.5">
                  <StatusBadge status={account?.status ?? 'active'} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <HeroCard>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-brand-orange/70">Current Plan</p>
              <p className="mt-2 text-3xl font-bold text-brand-orange">{tierInfo.label}</p>
              <p className="mt-1 text-sm text-white/50">{tierInfo.price}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-orange/20">
              <Crown className="h-5 w-5 text-brand-orange" />
            </div>
          </div>
          <ul className="mt-5 space-y-2.5">
            {tierInfo.features.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-white/70">
                <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-white/40">
            {dashboard.account.tier_renewal_date
              ? `Next renewal: ${formatDate(dashboard.account.tier_renewal_date)}`
              : 'Renewal date not available'}
          </p>
        </HeroCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Payment Method</h3>
          <div className="mt-5 space-y-3">
            {membership?.stripe_customer_id ? (
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                  <CreditCard className="h-4 w-4 text-brand-orange" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    Managed by Stripe
                  </p>
                  <p className="text-xs text-white/40 font-mono">
                    {membership.stripe_customer_id}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-white/40">
                No payment method on file. Upgrade your plan to add one.
              </p>
            )}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="/account/payments"
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white/50 transition hover:text-white"
            >
              View Payment History
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>
        </div>

        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Subscription Summary</h3>
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[--member-border] pb-3">
              <span className="text-sm text-white/50">Plan</span>
              <span className="text-sm font-medium text-white">
                {tierInfo.label} ({dashboard.account.plan_name})
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-[--member-border] pb-3">
              <span className="text-sm text-white/50">Status</span>
              <StatusBadge status={membership?.status ?? 'active'} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Membership ID</span>
              <span className="text-xs font-mono text-white/70 truncate max-w-[160px]">
                {membership?.membership_id ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Account Security</h3>
        <div className="mt-5 divide-y divide-[--member-border]">
          <div className="flex items-center justify-between py-4 first:pt-0">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <KeyRound className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Change Password</p>
                <p className="text-xs text-white/40">Password management</p>
              </div>
            </div>
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-[--member-border] px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/[0.04] hover:text-white">
              Update
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Smartphone className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Two-Factor Authentication</p>
                <p className="text-xs text-white/40">
                  {account?.two_factor_enabled ? 'Enabled' : 'Not enabled'}
                </p>
              </div>
            </div>
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-brand-orange/30 px-3 py-1.5 text-xs font-medium text-brand-orange transition hover:bg-brand-orange/10">
              {account?.two_factor_enabled ? 'Manage' : 'Enable'}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="flex items-center justify-between py-4 last:pb-0">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Monitor className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Active Sessions</p>
                <p className="text-xs text-white/40">Session management</p>
              </div>
            </div>
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-[--member-border] px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/[0.04] hover:text-white">
              Manage
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AccountSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Account</h1>
        <p className="mt-1 text-sm text-white/50">Loading account…</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        <div className="h-64 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      </div>
    </div>
  )
}

function AccountFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Account</h1>
        <p className="mt-1 text-sm text-white/50">Manage your account and membership.</p>
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
