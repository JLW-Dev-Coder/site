'use client'

import { useEffect, useState } from 'react'
import {
  FileText,
  CalendarCheck,
  Coins,
  ArrowDownRight,
  AlertCircle,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import { getDashboard } from '@/lib/api/dashboard'
import { getTokenUsage, type TokenUsageRow } from '@/lib/api/member'
import type { DashboardPayload } from '@/lib/api/types'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; dashboard: DashboardPayload; usage: TokenUsageRow[] }

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function eventMeta(u: TokenUsageRow): { title: string; tag: string; tagColor: string; dot: string; debit: boolean } {
  const action = (u.action || '').toLowerCase()
  if (action.includes('transcript') || action.includes('consume')) {
    return {
      title: `Transcript analysis`,
      tag: 'Report',
      tagColor: 'bg-brand-orange/10 text-brand-orange border-brand-orange/20',
      dot: 'bg-brand-orange',
      debit: true,
    }
  }
  if (action.includes('2848') || action.includes('8821') || action.includes('tool') || action.includes('game')) {
    return {
      title: 'Tool usage',
      tag: 'Tool',
      tagColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      dot: 'bg-blue-400',
      debit: true,
    }
  }
  if (action.includes('credit') || action.includes('purchase') || action.includes('subscription') || action.includes('renewed')) {
    return {
      title: 'Token credit',
      tag: 'Credit',
      tagColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      dot: 'bg-emerald-400',
      debit: false,
    }
  }
  return {
    title: u.action || 'Token activity',
    tag: 'Event',
    tagColor: 'bg-white/5 text-white/50 border-white/10',
    dot: 'bg-white/30',
    debit: false,
  }
}

export default function UsageClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dashboard = await getDashboard()
        if (cancelled) return
        const usage = await getTokenUsage(dashboard.account.account_id, 25).catch(() => [] as TokenUsageRow[])
        if (!cancelled) setState({ status: 'ready', dashboard, usage })
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not load usage',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') return <UsageSkeleton />
  if (state.status === 'error') return <UsageFallback message={state.message} />

  const { dashboard, usage } = state

  const reportsGenerated = dashboard.reports.generated_this_month
  const bookingsThisMonth = dashboard.bookings.this_month
  const tokensRemaining = dashboard.tokens.balance

  const reportDebits = usage.filter((u) => {
    const a = (u.action || '').toLowerCase()
    return a.includes('transcript') || a.includes('consume')
  })
  const toolDebits = usage.filter((u) => {
    const a = (u.action || '').toLowerCase()
    return a.includes('2848') || a.includes('8821') || a.includes('tool') || a.includes('game')
  })
  const totalDebits = reportDebits.length + toolDebits.length
  const reportsPct = totalDebits > 0 ? Math.round((reportDebits.length / totalDebits) * 100) : 0
  const toolsPct = totalDebits > 0 ? Math.round((toolDebits.length / totalDebits) * 100) : 0

  const usageSummary = [
    {
      label: 'Reports Generated',
      value: String(reportsGenerated),
      sub: `${reportsGenerated} this month`,
      icon: FileText,
    },
    {
      label: 'Calendar Bookings',
      value: String(bookingsThisMonth),
      sub: `${bookingsThisMonth} this month`,
      icon: CalendarCheck,
    },
    {
      label: 'Tokens Remaining',
      value: String(tokensRemaining),
      sub: 'Current balance',
      icon: Coins,
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Usage</h1>
        <p className="mt-1 text-sm text-white/50">
          Tool usage history and token consumption tracking.
        </p>
      </div>

      <HeroCard>
        <p className="text-xs uppercase tracking-widest text-brand-orange/70">Usage Summary</p>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          {usageSummary.map((s) => {
            const Icon = s.icon
            return (
              <div key={s.label} className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-orange/10">
                  <Icon className="h-5 w-5 text-brand-orange" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{s.value}</p>
                  <p className="text-[11px] uppercase tracking-widest text-white/40">{s.label}</p>
                  <p className="mt-0.5 text-xs text-white/30">{s.sub}</p>
                </div>
              </div>
            )
          })}
        </div>
      </HeroCard>

      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Token Consumption by Action</h3>
        {totalDebits === 0 ? (
          <p className="mt-5 text-sm text-white/40">No token consumption recorded yet.</p>
        ) : (
          <div className="mt-5 space-y-5">
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">Report Generation</span>
                <span className="font-medium text-white">{reportsPct}%</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-orange to-brand-amber transition-all"
                  style={{ width: `${reportsPct}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">Tool Usage</span>
                <span className="font-medium text-white">{toolsPct}%</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all"
                  style={{ width: `${toolsPct}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Recent Tool Events</h3>
        {usage.length === 0 ? (
          <p className="mt-5 text-sm text-white/40">No recent events.</p>
        ) : (
          <div className="mt-4 divide-y divide-[--member-border]">
            {usage.slice(0, 10).map((u, i) => {
              const meta = eventMeta(u)
              return (
                <div key={u.eventId || i} className="flex items-start gap-3 py-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-white/80">{meta.title}</p>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.tagColor}`}
                      >
                        {meta.tag}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-white/40">{formatTimestamp(u.createdAt)}</p>
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-0.5 text-sm font-medium ${
                      meta.debit ? 'text-red-400' : 'text-emerald-400'
                    }`}
                  >
                    {meta.debit && <ArrowDownRight className="h-3.5 w-3.5" />}
                    {meta.debit ? `-${Math.abs(u.amount)}` : `+${u.amount}`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function UsageSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Usage</h1>
        <p className="mt-1 text-sm text-white/50">Loading usage…</p>
      </div>
      <div className="h-36 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      <div className="h-48 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      <div className="h-64 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
    </div>
  )
}

function UsageFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Usage</h1>
        <p className="mt-1 text-sm text-white/50">
          Tool usage history and token consumption tracking.
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
