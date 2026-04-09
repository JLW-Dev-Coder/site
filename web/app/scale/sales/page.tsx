'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'

interface ScaleResponses {
  bookings?: { paid: number }
  purchases?: { count: number; total_revenue: number }
}

interface StripeTransaction {
  id: string
  amount: number
  currency: string
  status: string
  description: string
  email: string
  customer?: string | null
  created: number
  platform?: string
  receipt_url?: string | null
}

interface AdminStats {
  mrr_total?: number
  mrr_by_platform?: Record<string, number>
  membership_distribution?: Record<string, number>
  memberships_by_tier?: Record<string, number>
  total_accounts?: number
  tokens?: { transcript_total: number; tax_game_total: number; holder_count: number }
  recent_transactions?: Array<{
    id: string
    amount: number
    email: string
    description: string
    created: number
    platform?: string
  }>
  stripe_transactions?: StripeTransaction[]
  stripe_errors?: string[]
  token_purchases?: { count: number; revenue: number }
}

const PLATFORMS = ['vlp', 'tmp', 'ttmp', 'tttmp', 'dvlp', 'gvlp', 'tcvlp', 'wlvlp']
const TIERS = ['Listed', 'Active', 'Featured', 'Premier']

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function ScaleSalesPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [scale, setScale] = useState<ScaleResponses | null>(null)
  const [loading, setLoading] = useState(true)
  const [adminAvailable, setAdminAvailable] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const adminRes = await fetch('https://api.virtuallaunch.pro/v1/admin/stats', { credentials: 'include' })
        if (adminRes.ok) {
          setStats(await adminRes.json())
        } else {
          setAdminAvailable(false)
        }
        const dash = await fetch('https://api.virtuallaunch.pro/v1/scale/dashboard', { credentials: 'include' })
        if (dash.ok) {
          const data = await dash.json()
          setScale(data.responses ?? null)
        }
      } catch {
        setAdminAvailable(false)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const mrrTotal = stats?.mrr_total ?? 0
  const scaleRevenue = scale?.purchases?.total_revenue ?? 0
  const visibleTransactions = (stats?.stripe_transactions ?? []).filter(
    (tx) => (tx.status === 'succeeded' || tx.status === 'paid') && tx.amount > 0,
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Sales</h1>
        <p className="mt-1 text-sm text-slate-400">Stripe revenue, MRR, and conversions across all platforms</p>
      </div>

      {!adminAvailable && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-300">
          Note: <code>/v1/admin/stats</code> not yet implemented in Worker. MRR, transactions, and tier distribution show placeholder data. SCALE-attributed revenue is live below.
        </div>
      )}

      {/* Top metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">MRR (All Platforms)</div>
          <div className="mt-2 text-3xl font-bold text-white">{fmtCurrency(mrrTotal)}</div>
          {!adminAvailable && <div className="mt-1 text-xs text-slate-600">placeholder</div>}
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">SCALE Revenue</div>
          <div className="mt-2 text-3xl font-bold text-emerald-400">{fmtCurrency(scaleRevenue)}</div>
          <div className="mt-1 text-xs text-slate-500">{scale?.purchases?.count ?? 0} purchases</div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">SCALE Paid Calls</div>
          <div className="mt-2 text-3xl font-bold text-white">{scale?.bookings?.paid ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Token Purchases</div>
          <div className="mt-2 text-3xl font-bold text-white">{stats?.token_purchases?.count ?? 0}</div>
          <div className="mt-1 text-xs text-slate-500">{fmtCurrency(stats?.token_purchases?.revenue ?? 0)}</div>
        </Card>
      </div>

      {/* MRR by platform */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">MRR by Platform</div>
        <div className="grid gap-4 sm:grid-cols-4">
          {PLATFORMS.map((p) => (
            <div key={p}>
              <div className="text-xs uppercase text-slate-500">{p}</div>
              <div className="mt-1 text-lg font-bold text-white">
                {fmtCurrency(stats?.mrr_by_platform?.[p] ?? 0)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Membership distribution */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">VLP Membership Distribution</div>
        <div className="grid gap-4 sm:grid-cols-4">
          {TIERS.map((tier) => (
            <div key={tier}>
              <div className="text-xs uppercase text-slate-500">{tier}</div>
              <div className="mt-1 text-2xl font-bold text-white">
                {stats?.membership_distribution?.[tier.toLowerCase()] ?? 0}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Stripe transactions */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent Stripe Payment Intents</div>
          {stats?.stripe_errors && stats.stripe_errors.length > 0 && (
            <div className="text-xs text-amber-400">errors: {stats.stripe_errors.join(', ')}</div>
          )}
        </div>
        <div className="mb-4 text-xs text-slate-500">
          Showing completed payments only. Incomplete and $0 sessions are excluded.
        </div>
        {loading ? (
          <div className="text-slate-500 py-6 text-center text-sm">Loading…</div>
        ) : visibleTransactions.length === 0 ? (
          <div className="text-slate-500 py-8 text-center text-sm">
            No completed Stripe payments to show.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-800/60">
                  <th className="py-2 px-2">Date</th>
                  <th className="py-2 px-2">Amount</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Customer</th>
                  <th className="py-2 px-2">Description</th>
                  <th className="py-2 px-2">Acct</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {visibleTransactions.map((tx) => (
                  <tr key={tx.id} className="text-slate-300">
                    <td className="py-2 px-2 whitespace-nowrap text-xs text-slate-500">
                      {new Date(tx.created * 1000).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap font-bold text-emerald-400">
                      {fmtCurrency(tx.amount / 100)}
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className={
                        tx.status === 'succeeded' || tx.status === 'paid' ? 'text-emerald-400' :
                        tx.status === 'canceled' || tx.status === 'failed' ? 'text-rose-400' :
                        'text-amber-400'
                      }>
                        {tx.status || '—'}
                      </span>
                    </td>
                    <td className="py-2 px-2 truncate max-w-[200px]" title={tx.email}>
                      {tx.email || <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-2 px-2 truncate max-w-[260px]" title={tx.description}>
                      {tx.description || <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-2 px-2 text-xs uppercase text-slate-500">{tx.platform}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
