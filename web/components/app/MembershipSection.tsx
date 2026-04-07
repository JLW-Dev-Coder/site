'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'

type Cycle = 'monthly' | 'yearly'
type PlanKey = 'free' | 'starter' | 'scale' | 'advanced'

interface PlanCycle {
  billingObject: string
  planKey: string
  price: string
  suffix: string
}

interface PlanDef {
  key: PlanKey
  label: string
  badge: string
  featured: boolean
  body: string
  features: string[]
  monthly: PlanCycle
  yearly: PlanCycle
}

const PLANS: PlanDef[] = [
  {
    key: 'free',
    label: 'Listed',
    badge: 'Start here',
    featured: false,
    body: 'For tax professionals getting started, exploring the platform, and joining the network before stepping into paid membership.',
    features: ['Account management', 'Calendar/scheduling', 'Profile management', 'Support tickets', 'Token balance', 'Tool usage history'],
    monthly: { billingObject: '', planKey: 'vlp_free', price: '0', suffix: '/mo' },
    yearly:  { billingObject: '', planKey: 'vlp_free', price: '0', suffix: '/yr' },
  },
  {
    key: 'starter',
    label: 'Active',
    badge: 'Best for solo pros',
    featured: false,
    body: 'For solo tax professionals who need taxpayer service pool access, a directory listing, and core token tools.',
    features: ['Everything in Listed', 'Directory profile', 'Pro↔taxpayer messaging', 'Taxpayer service pool access', '2 transcript + 5 game tokens monthly'],
    monthly: { billingObject: 'price_1T9APS9ROeyeXOqeOWjA4sq3', planKey: 'vlp_starter', price: '79', suffix: '/mo' },
    yearly:  { billingObject: 'price_1TBjy19ROeyeXOqeyzbwP3hW', planKey: 'vlp_starter', price: '790', suffix: '/yr' },
  },
  {
    key: 'scale',
    label: 'Featured',
    badge: 'Most popular',
    featured: true,
    body: 'For active tax professionals who want featured network placement, priority pool access, and full token capacity.',
    features: ['Everything in Active', 'Sponsored placement on TMP', 'Priority pool access', 'Featured network listing', '5 transcript + 15 game tokens monthly'],
    monthly: { billingObject: 'price_1T9AUi9ROeyeXOqeqyzsSOYV', planKey: 'vlp_scale', price: '199', suffix: '/mo' },
    yearly:  { billingObject: 'price_1TBk0K9ROeyeXOqeC3sHQqFN', planKey: 'vlp_scale', price: '1990', suffix: '/yr' },
  },
  {
    key: 'advanced',
    label: 'Premier',
    badge: 'For high volume',
    featured: false,
    body: 'For high-volume practices that need top-tier network promotion, early case access, and maximum token throughput.',
    features: ['Everything in Featured', 'Sponsored placement on TMP + TTMP + TTTMP', 'Early case access', 'Top-tier network promotion', '10 transcript + 40 game tokens monthly'],
    monthly: { billingObject: 'price_1T9AXX9ROeyeXOqef7Ja1Iig', planKey: 'vlp_advanced', price: '399', suffix: '/mo' },
    yearly:  { billingObject: 'price_1TBk1G9ROeyeXOqeBQcj749T', planKey: 'vlp_advanced', price: '3990', suffix: '/yr' },
  },
]

const PLAN_RANK: Record<PlanKey, number> = { free: 0, starter: 1, scale: 2, advanced: 3 }

interface TokenBalance {
  taxGameTokens: number
  transcriptTokens: number
}

interface Props {
  accountId: string
  membership: string
}

function normalizePlan(value: string): PlanKey {
  const v = (value || '').toLowerCase().replace(/^vlp_/, '').replace(/_(monthly|yearly)$/, '')
  if (v === 'starter' || v === 'scale' || v === 'advanced') return v
  return 'free'
}

export default function MembershipSection({ accountId, membership }: Props) {
  const [tokens, setTokens] = useState<TokenBalance | null>(null)
  const [livePlan, setLivePlan] = useState<PlanKey>(normalizePlan(membership))
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [loadingPortal, setLoadingPortal] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  useEffect(() => {
    fetch('https://api.virtuallaunch.pro/v1/auth/session', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const m = data?.session?.membership
        if (m) setLivePlan(normalizePlan(m))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!accountId) return
    fetch(`https://api.virtuallaunch.pro/v1/tokens/balance/${accountId}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setTokens({ taxGameTokens: data.taxGameTokens ?? 0, transcriptTokens: data.transcriptTokens ?? 0 })
      })
      .catch(() => {})
  }, [accountId])

  async function handleCheckout(billingObject: string, planKey: string) {
    setLoadingPlan(planKey)
    setPlanError(null)
    try {
      const res = await fetch('https://api.virtuallaunch.pro/v1/checkout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ billingObject, planKey }),
      })
      const data = await res.json()
      if (data.ok && data.url) {
        window.location.href = data.url
      } else {
        setPlanError(data.message || 'Checkout failed. Please try again.')
      }
    } catch {
      setPlanError('Network error. Please try again.')
    } finally {
      setLoadingPlan(null)
    }
  }

  async function handlePortal() {
    setLoadingPortal(true)
    try {
      const res = await fetch('https://api.virtuallaunch.pro/v1/billing/portal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accountId }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch {/* ignore */} finally {
      setLoadingPortal(false)
    }
  }

  const currentRank = PLAN_RANK[livePlan]

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Membership</h2>
        {livePlan !== 'free' && (
          <button
            type="button"
            onClick={handlePortal}
            disabled={loadingPortal}
            className="shrink-0 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white transition disabled:opacity-60"
          >
            {loadingPortal ? 'Loading…' : 'Manage Billing'}
          </button>
        )}
      </div>

      {/* Token balances */}
      {tokens !== null && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tax Game Tokens</div>
            <div className="mt-1 text-2xl font-bold text-white">{tokens.taxGameTokens.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transcript Tokens</div>
            <div className="mt-1 text-2xl font-bold text-white">{tokens.transcriptTokens.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Billing cycle toggle */}
      <div className="mb-6 flex justify-center">
        <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 p-1">
          <button
            type="button"
            onClick={() => setCycle('monthly')}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${cycle === 'monthly' ? 'bg-orange-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setCycle('yearly')}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${cycle === 'yearly' ? 'bg-orange-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
          >
            Yearly
          </button>
        </div>
      </div>

      {planError && <p className="mb-3 text-xs text-red-400 text-center">{planError}</p>}

      {/* Plan cards */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => {
          const data = p[cycle]
          const isCurrent = p.key === livePlan
          const rank = PLAN_RANK[p.key]
          const isUpgrade = rank > currentRank
          const isDowngrade = rank < currentRank
          const isFree = p.key === 'free'

          let actionLabel = 'Current Plan'
          if (isUpgrade) actionLabel = 'Upgrade'
          else if (isDowngrade) actionLabel = 'Downgrade'

          const buttonDisabled = isCurrent || loadingPlan !== null || isFree

          return (
            <article
              key={p.key}
              className={`relative rounded-2xl p-5 shadow-[0_10px_30px_rgba(0,0,0,0.12)] transition ${
                isCurrent
                  ? 'border-2 border-orange-500 bg-gradient-to-b from-orange-500/10 to-orange-500/5'
                  : p.featured
                    ? 'border-2 border-orange-500/40 bg-white/5'
                    : 'border border-white/10 bg-white/5'
              }`}
            >
              {isCurrent && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-orange-500 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-950">
                  Current Plan
                </span>
              )}

              <div className="flex items-center justify-between mb-2">
                <div className="text-base font-extrabold text-white">{p.label}</div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${p.featured ? 'border border-orange-500/40 bg-orange-500/10 text-white/90' : 'border border-white/10 bg-white/5 text-white/70'}`}>
                  {p.badge}
                </span>
              </div>

              <div className="mt-2">
                <div className="text-3xl font-extrabold text-white">${data.price}</div>
                <div className="mt-0.5 text-xs text-white/60">{data.suffix}</div>
              </div>

              <p className="mt-3 text-xs text-white/70">{p.body}</p>

              <ul className="mt-4 space-y-2 text-xs text-white/75">
                {p.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => handleCheckout(data.billingObject, data.planKey)}
                disabled={buttonDisabled}
                className={`mt-5 w-full rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${
                  isCurrent
                    ? 'border border-orange-500/40 bg-orange-500/10 text-orange-300 cursor-default'
                    : isFree
                      ? 'border border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                      : 'bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 hover:from-orange-400 hover:to-amber-400 disabled:opacity-60'
                }`}
              >
                {loadingPlan === data.planKey ? 'Redirecting…' : actionLabel}
              </button>
            </article>
          )
        })}
      </div>
    </Card>
  )
}
