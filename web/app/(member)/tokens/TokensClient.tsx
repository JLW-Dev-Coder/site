'use client'

import { useEffect, useState } from 'react'
import {
  Coins,
  FileText,
  CalendarCheck,
  Wallet,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import KPICard from '../components/KPICard'
import { getDashboard } from '@/lib/api/dashboard'
import { getTokenUsage, type TokenUsageRow } from '@/lib/api/member'
import type { DashboardPayload } from '@/lib/api/types'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; dashboard: DashboardPayload; usage: TokenUsageRow[] }

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function labelForAction(action: string): { label: string; type: string; credit: boolean } {
  const a = (action || '').toLowerCase()
  if (a.includes('purchase')) return { label: 'Token purchase', type: 'Credit', credit: true }
  if (a.includes('subscription') || a.includes('renewed') || a.includes('created') || a.includes('updated'))
    return { label: 'Monthly plan allocation', type: 'Credit', credit: true }
  if (a.includes('credit')) return { label: 'Manual credit', type: 'Credit', credit: true }
  if (a.includes('consume') || a.includes('transcript')) return { label: 'Transcript analysis', type: 'Report', credit: false }
  if (a.includes('game') || a.includes('2848') || a.includes('8821') || a.includes('tool'))
    return { label: 'Tool usage', type: 'Tool', credit: false }
  return { label: action || 'Token activity', type: 'Usage', credit: false }
}

export default function TokensClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dashboard = await getDashboard()
        if (cancelled) return
        let usage: TokenUsageRow[] = []
        try {
          usage = await getTokenUsage(dashboard.account.account_id, 25)
        } catch {
          usage = []
        }
        if (!cancelled) setState({ status: 'ready', dashboard, usage })
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not load tokens',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return <TokensSkeleton />
  }

  if (state.status === 'error') {
    return <TokensFallback message={state.message} />
  }

  const { dashboard, usage } = state
  const { tokens, account } = dashboard
  const balance = tokens.balance ?? 0
  const monthlyAllocation = tokens.monthly_allocation ?? 0

  // Derive "used this month" from debit-type events in the current month
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const usedThisMonth = usage
    .filter((u) => {
      const ts = new Date(u.createdAt).getTime()
      if (Number.isNaN(ts)) return false
      if (ts < monthStart.getTime()) return false
      const meta = labelForAction(u.action)
      return !meta.credit
    })
    .reduce((sum, u) => sum + (Math.abs(u.amount) || 0), 0)

  const usagePercent = monthlyAllocation > 0
    ? Math.min(100, Math.round((usedThisMonth / monthlyAllocation) * 100))
    : 0

  const reportsGenerated = dashboard.reports.generated_this_month
  const bookingsThisMonth = dashboard.bookings.this_month

  const allocations = [
    {
      label: 'Reports Generated',
      value: String(reportsGenerated),
      change: `${reportsGenerated} tokens used`,
      trend: 'neutral' as const,
      icon: FileText,
    },
    {
      label: 'Calendar Bookings',
      value: String(bookingsThisMonth),
      change: `${bookingsThisMonth} sessions`,
      trend: 'neutral' as const,
      icon: CalendarCheck,
    },
    {
      label: 'Remaining Balance',
      value: String(balance),
      change: 'Transcript tokens',
      trend: 'neutral' as const,
      icon: Wallet,
    },
  ]

  // Rolling running balance (latest entry = current balance)
  let running = balance
  const activityRows = usage.slice(0, 15).map((u) => {
    const meta = labelForAction(u.action)
    const row = {
      activity: meta.label,
      type: meta.type,
      amount: meta.credit ? `+${u.amount}` : `-${Math.abs(u.amount)}`,
      credit: meta.credit,
      date: formatDate(u.createdAt),
      balance: String(running),
    }
    // Undo this row to get the balance before it
    running = meta.credit ? running - u.amount : running + Math.abs(u.amount)
    return row
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Tokens</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage your token balance and purchases.
        </p>
      </div>

      <HeroCard>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-orange/70">Token Balance</p>
            <p className="mt-3 text-5xl font-bold text-white">{balance}</p>
            <p className="mt-2 text-sm text-white/50">
              Tokens replenish monthly with your subscription. Use them for
              transcript reports, calendar bookings, and premium tools.
            </p>
            {monthlyAllocation > 0 && (
              <div className="mt-1 text-xs text-white/40">
                Monthly allocation: +{monthlyAllocation} transcript tokens
              </div>
            )}
          </div>
          <div className="shrink-0">
            <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90">
              <Plus className="h-4 w-4" />
              Refill Tokens
            </button>
          </div>
        </div>
      </HeroCard>

      <div className="grid gap-4 sm:grid-cols-3">
        {allocations.map((a) => (
          <KPICard
            key={a.label}
            label={a.label}
            value={a.value}
            change={a.change}
            trend="neutral"
            icon={a.icon}
          />
        ))}
      </div>

      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Membership Token Summary</h3>
        <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/40">Current Plan</p>
            <p className="mt-1 text-lg font-semibold text-brand-orange">{account.plan_name}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/40">Next Renewal</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {account.tier_renewal_date ? formatDate(account.tier_renewal_date) : '—'}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/40">Tokens / Month</p>
            <p className="mt-1 text-lg font-semibold text-white">{monthlyAllocation}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/40">Used This Month</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {usedThisMonth}{' '}
              <span className="text-sm font-normal text-white/40">of {monthlyAllocation}</span>
            </p>
          </div>
        </div>

        {monthlyAllocation > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between text-xs text-white/40">
              <span>Monthly allocation used</span>
              <span>{usagePercent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-orange to-brand-amber transition-all"
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-4 flex items-center gap-2">
          <Coins className="h-4 w-4 text-white/30" />
          <h3 className="text-xs uppercase tracking-widest text-white/40">Recent Token Activity</h3>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[--member-border] bg-[--member-card]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[--member-border]">
                <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium">Activity</th>
                <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium">Type</th>
                <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium">Tokens</th>
                <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium">Date</th>
                <th className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {activityRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-white/40">
                    No token activity yet.
                  </td>
                </tr>
              ) : (
                activityRows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-[--member-border] last:border-b-0 transition hover:bg-[--member-card-hover]"
                  >
                    <td className="px-5 py-3.5 font-medium text-white">{row.activity}</td>
                    <td className="px-5 py-3.5 text-white/50">{row.type}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1 font-medium ${
                        row.credit ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {row.credit ? (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5" />
                        )}
                        {row.amount}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-white/50">{row.date}</td>
                    <td className="px-5 py-3.5 text-right text-white/70">{row.balance}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TokensSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Tokens</h1>
        <p className="mt-1 text-sm text-white/50">Loading balance…</p>
      </div>
      <div className="h-36 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      <div className="h-56 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
    </div>
  )
}

function TokensFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Tokens</h1>
        <p className="mt-1 text-sm text-white/50">Manage your token balance and purchases.</p>
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
