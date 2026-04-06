'use client'

import { useState, useEffect } from 'react'

type Cycle = 'monthly' | 'yearly'

interface PlanCycle {
  billingObject: string
  checkoutHref: string
  planKey: string
  platformFee: string
  price: string
  suffix: string
  taxGameTokens: string
  transcriptTokens: string
}

interface PlanData {
  monthly: PlanCycle
  yearly: PlanCycle
}

const DEFAULT_PLANS: Record<string, PlanData> = {
  free: {
    monthly: { billingObject: 'price_1TBjsM9ROeyeXOqeAPefMFfM', checkoutHref: '#', planKey: 'vlp_free', platformFee: '0', price: '0', suffix: '/mo', taxGameTokens: '0', transcriptTokens: '0' },
    yearly:  { billingObject: 'price_1TBjsM9ROeyeXOqeAPefMFfM', checkoutHref: '#', planKey: 'vlp_free', platformFee: '0', price: '0', suffix: '/yr', taxGameTokens: '0', transcriptTokens: '0' },
  },
  starter: {
    monthly: { billingObject: 'price_1T9APS9ROeyeXOqeOWjA4sq3', checkoutHref: '#', planKey: 'vlp_starter', platformFee: '12', price: '79', suffix: '/mo', taxGameTokens: '5', transcriptTokens: '2' },
    yearly:  { billingObject: 'price_1TBjy19ROeyeXOqeyzbwP3hW', checkoutHref: '#', planKey: 'vlp_starter', platformFee: '12', price: '790', suffix: '/yr', taxGameTokens: '5', transcriptTokens: '2' },
  },
  scale: {
    monthly: { billingObject: 'price_1T9AUi9ROeyeXOqeqyzsSOYV', checkoutHref: '#', planKey: 'vlp_scale', platformFee: '12', price: '199', suffix: '/mo', taxGameTokens: '15', transcriptTokens: '5' },
    yearly:  { billingObject: 'price_1TBk0K9ROeyeXOqeC3sHQqFN', checkoutHref: '#', planKey: 'vlp_scale', platformFee: '12', price: '1990', suffix: '/yr', taxGameTokens: '15', transcriptTokens: '5' },
  },
  advanced: {
    monthly: { billingObject: 'price_1T9AXX9ROeyeXOqef7Ja1Iig', checkoutHref: '#', planKey: 'vlp_advanced', platformFee: '12', price: '399', suffix: '/mo', taxGameTokens: '40', transcriptTokens: '10' },
    yearly:  { billingObject: 'price_1TBk1G9ROeyeXOqeBQcj749T', checkoutHref: '#', planKey: 'vlp_advanced', platformFee: '12', price: '3990', suffix: '/yr', taxGameTokens: '40', transcriptTokens: '10' },
  },
}

const PLAN_ORDER = ['free', 'starter', 'scale', 'advanced'] as const
type PlanKey = typeof PLAN_ORDER[number]

function readFirst(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = source[key]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

function normalizePlanKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^vlp_/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_(monthly|yearly)$/, '')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeRemote(payload: any, plans: Record<string, PlanData>): Record<string, PlanData> {
  const next = JSON.parse(JSON.stringify(plans)) as Record<string, PlanData>

  let buckets: Record<string, unknown>[] = []
  if (Array.isArray(payload)) buckets = payload
  else if (Array.isArray(payload?.plans)) buckets = payload.plans
  else if (Array.isArray(payload?.data)) buckets = payload.data
  else if (payload?.plans && typeof payload.plans === 'object') {
    Object.keys(payload.plans).forEach((k) => buckets.push({ plan: k, ...(payload.plans[k] as object) }))
  }

  for (const entry of buckets) {
    const plan = normalizePlanKey(readFirst(entry as Record<string, unknown>, ['plan', 'planKey', 'plan_key', 'slug', 'name']))
    if (!plan || !next[plan]) continue

    const asCycle = (src: Record<string, unknown>, fallback: Cycle): PlanCycle => ({
      billingObject: readFirst(src, ['billingObject', 'priceId', 'price_id']) || next[plan][fallback].billingObject,
      checkoutHref: readFirst(src, ['checkoutHref', 'checkoutUrl', 'href']) || next[plan][fallback].checkoutHref,
      planKey: readFirst(src, ['planKey', 'plan_key', 'slug']) || next[plan][fallback].planKey,
      platformFee: readFirst(src, ['platformFee', 'platform_fee_percent']) || next[plan][fallback].platformFee,
      price: readFirst(src, ['price', 'cost', 'priceAmount']) || next[plan][fallback].price,
      suffix: fallback === 'yearly' ? '/yr' : '/mo',
      taxGameTokens: readFirst(src, ['taxGameTokens', 'tax_tool_tokens_monthly']) || next[plan][fallback].taxGameTokens,
      transcriptTokens: readFirst(src, ['transcriptTokens', 'transcript_tokens_monthly']) || next[plan][fallback].transcriptTokens,
    })

    if (entry.monthly) next[plan].monthly = asCycle(entry.monthly as Record<string, unknown>, 'monthly')
    if (entry.yearly)  next[plan].yearly  = asCycle(entry.yearly  as Record<string, unknown>, 'yearly')
  }

  return next
}

const planFeatures: Record<PlanKey, string[]> = {
  free:     ['Account management', 'Calendar/scheduling', 'Profile management', 'Support tickets', 'Token balance', 'Tool usage history'],
  starter:  ['Everything in Listed', 'Directory profile', 'Pro↔taxpayer messaging', 'Taxpayer service pool access', '2 transcript + 5 game tokens monthly'],
  scale:    ['Everything in Active', 'Sponsored placement on TMP', 'Priority pool access', 'Featured network listing', '5 transcript + 15 game tokens monthly'],
  advanced: ['Everything in Featured', 'Sponsored placement on TMP + TTMP + TTTMP', 'Early case access', 'Top-tier network promotion', '10 transcript + 40 game tokens monthly'],
}

const planMeta: Record<PlanKey, { label: string; badge: string; featured: boolean; body: string }> = {
  free:     { label: 'Listed',   badge: 'Start here',        featured: false, body: 'For tax professionals getting started, exploring the platform, and joining the network before stepping into paid membership.' },
  starter:  { label: 'Active',   badge: 'Best for solo pros', featured: false, body: 'For solo tax professionals who need taxpayer service pool access, a directory listing, and core token tools.' },
  scale:    { label: 'Featured', badge: 'Most popular',      featured: true,  body: 'For active tax professionals who want featured network placement, priority pool access, and full token capacity.' },
  advanced: { label: 'Premier',  badge: 'For high volume',   featured: false, body: 'For high-volume practices that need top-tier network promotion, early case access, and maximum token throughput.' },
}

export default function PricingPage() {
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [plans, setPlans] = useState(DEFAULT_PLANS)
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [planErrors, setPlanErrors] = useState<Record<string, string>>({})

  async function handleCheckout(data: PlanCycle) {
    if (data.price === '0') { window.location.href = '/sign-in'; return; }
    setLoadingPlan(data.planKey)
    setPlanErrors((prev) => ({ ...prev, [data.planKey]: '' }))
    try {
      const res = await fetch('https://api.virtuallaunch.pro/v1/checkout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ billingObject: data.billingObject, planKey: data.planKey }),
      })
      const payload = await res.json()
      if (payload.ok && payload.url) {
        window.location.href = payload.url
      } else {
        setPlanErrors((prev) => ({ ...prev, [data.planKey]: payload.message || 'Checkout failed. Please try again.' }))
      }
    } catch {
      setPlanErrors((prev) => ({ ...prev, [data.planKey]: 'Network error. Please try again.' }))
    } finally {
      setLoadingPlan(null)
    }
  }

  useEffect(() => {
    fetch('https://api.virtuallaunch.pro/v1/pricing', { headers: { Accept: 'application/json' } })
      .then((r) => r.ok ? r.json() : null)
      .then((payload) => { if (payload) setPlans((prev) => mergeRemote(payload, prev)) })
      .catch(() => {/* silently use defaults */})
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <section className="mx-auto max-w-[77.5rem] px-4 pb-10 pt-16 md:pb-14 md:pt-24">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/50 px-4 py-2">
            <svg className="h-4 w-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-slate-300">Monthly and yearly memberships aligned to the current Worker config.</span>
          </div>

          <h1 className="mb-6 text-4xl font-bold tracking-tight md:text-6xl lg:text-7xl">
            Pricing{' '}
            <span className="bg-gradient-to-br from-amber-400 to-amber-600 bg-clip-text text-transparent">
              &amp; Plans
            </span>
          </h1>

          <p className="mx-auto mb-12 max-w-3xl text-xl leading-relaxed text-slate-400 md:text-2xl">
            Choose Listed, Active, Featured, or Premier. Pricing, tokens, and plan keys stay aligned to the live billing structure.
          </p>

          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <a href="#pricing-cards" className="inline-block rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-8 py-4 text-lg font-semibold text-slate-950 shadow-lg shadow-amber-500/25 transition-all duration-200 hover:from-amber-400 hover:to-amber-500 hover:scale-105">
              View packages →
            </a>
            <a href="/features" className="inline-block rounded-lg border border-slate-700 bg-slate-900/60 px-8 py-4 text-lg font-semibold text-slate-100 transition-all duration-200 hover:bg-slate-800/80">
              Explore features
            </a>
          </div>
        </div>
      </section>

      {/* Plan cards */}
      <section id="pricing-cards" className="border-t border-white/10">
        <div className="mx-auto max-w-[77.5rem] px-4 py-16 md:py-20">
          <div className="mx-auto max-w-3xl text-center mb-10">
            <p className="text-xs font-semibold tracking-widest text-orange-400">PACKAGES</p>
            <h2 className="mt-4 text-4xl font-extrabold md:text-5xl">Pick the membership that fits your stage</h2>
            <p className="mx-auto mt-5 max-w-2xl text-base text-white/70">
              Toggle monthly or yearly. Each paid plan carries a 12% platform fee. Free stays at 0%.
            </p>

            {/* Billing toggle */}
            <div className="mt-8 inline-flex items-center rounded-full border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setCycle('monthly')}
                className={`rounded-full px-4 py-2 text-sm font-bold transition ${cycle === 'monthly' ? 'bg-orange-500 text-[#070a10]' : 'text-white/80 hover:text-white'}`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setCycle('yearly')}
                className={`rounded-full px-4 py-2 text-sm font-bold transition ${cycle === 'yearly' ? 'bg-orange-500 text-[#070a10]' : 'text-white/80 hover:text-white'}`}
              >
                Yearly
              </button>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-4">
            {PLAN_ORDER.map((key) => {
              const meta = planMeta[key]
              const data = plans[key][cycle]
              return (
                <article
                  key={key}
                  className={`rounded-2xl p-8 shadow-[0_10px_30px_rgba(0,0,0,0.12)] ${
                    meta.featured
                      ? 'border-2 border-orange-500/70 bg-gradient-to-b from-white/8 to-white/5'
                      : 'border border-white/10 bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-lg font-extrabold">{meta.label}</div>
                    <span className={`rounded-full px-3 py-1 text-xs ${meta.featured ? 'border border-orange-500/40 bg-orange-500/10 text-white/90' : 'border border-white/10 bg-white/5 text-white/80'}`}>
                      {meta.badge}
                    </span>
                  </div>
                  <div className="mt-4">
                    <div className="text-4xl font-extrabold">${data.price}</div>
                    <div className="mt-2 text-sm text-white/70">{data.suffix}</div>
                  </div>
                  <p className="mt-5 text-sm text-white/70">{meta.body}</p>
                  <ul className="mt-6 space-y-3 text-sm text-white/75">
                    {planFeatures[key].map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {planErrors[data.planKey] && loadingPlan !== data.planKey && (
                    <p className="mt-4 text-xs text-red-400">{planErrors[data.planKey]}</p>
                  )}
                  <div className="mt-8 flex gap-3">
                    <button
                      type="button"
                      onClick={() => handleCheckout(data)}
                      disabled={loadingPlan !== null}
                      className="flex-1 rounded-xl bg-orange-500 px-5 py-3 text-center text-sm font-extrabold text-[#070a10] hover:bg-orange-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loadingPlan === data.planKey ? 'Redirecting...' : 'Get started'}
                    </button>
                    <a href="#comparison" className="rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-center text-sm font-extrabold text-white hover:bg-white/10 transition-colors">
                      Compare
                    </a>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section id="comparison" className="border-t border-white/10">
        <div className="mx-auto max-w-[77.5rem] px-4 py-16 md:py-20">
          <div className="mx-auto max-w-3xl text-center mb-12">
            <p className="text-xs font-semibold tracking-widest text-orange-400">COMPARISON</p>
            <h2 className="mt-4 text-4xl font-extrabold md:text-5xl">What each membership includes</h2>
            <p className="mx-auto mt-5 max-w-2xl text-base text-white/70">
              Compare monthly token allocations, platform fees, and internal plan details across each tier.
            </p>
          </div>

          <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/5 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
            <table className="min-w-full table-fixed border-collapse text-sm text-white/75">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-white">
                  <th className="p-4 font-semibold uppercase text-left">Features</th>
                  {PLAN_ORDER.map((k) => (
                    <th key={k} className="p-4 font-semibold uppercase text-center">{planMeta[k].label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Monthly cost', fn: (d: PlanCycle) => `$${d.price}` },
                  { label: 'Monthly transcript tokens', fn: (d: PlanCycle) => d.transcriptTokens },
                  { label: 'Monthly game tokens', fn: (d: PlanCycle) => d.taxGameTokens },
                  { label: 'Platform fee', fn: (d: PlanCycle) => `${d.platformFee}%` },
                  { label: 'Plan key', fn: (d: PlanCycle) => d.planKey },
                  { label: 'Billing object', fn: (d: PlanCycle) => d.billingObject },
                ].map((row, i) => (
                  <tr key={row.label} className={`border-b border-white/10 align-middle ${i % 2 !== 0 ? 'bg-white/[0.02]' : ''}`}>
                    <td className="p-4 font-medium text-white">{row.label}</td>
                    {PLAN_ORDER.map((k) => (
                      <td key={k} className="p-4 text-center">{row.fn(plans[k][cycle])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 md:py-24 bg-gradient-to-br from-[#0f172a] via-[#1c1917] to-[#7c2d12] text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">
            Ready to{' '}
            <span className="bg-gradient-to-br from-amber-400 to-amber-600 bg-clip-text text-transparent">
              start your membership?
            </span>
          </h2>
          <p className="text-lg md:text-xl text-white/80 mb-8 max-w-2xl mx-auto">
            Choose the plan that fits your practice and start using the tools, automation, and network features designed to support calmer launches and cleaner client operations.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="#pricing-cards" className="bg-orange-500 hover:bg-orange-400 text-white font-bold px-10 py-4 rounded-xl text-lg transition-all shadow-lg hover:shadow-xl">
              Become a member
            </a>
            <a href="/features" className="bg-white/10 hover:bg-white/15 text-white font-semibold px-10 py-4 rounded-xl text-lg border border-orange-400/20 transition-all">
              Explore features
            </a>
          </div>
          <p className="text-white/60 text-sm mt-8">Become a member • Deliver calmly • Repeat</p>
        </div>
      </section>
    </div>
  )
}






