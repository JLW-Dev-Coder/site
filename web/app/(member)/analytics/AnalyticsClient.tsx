'use client'

import { useEffect, useState } from 'react'
import {
  BarChart3,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  Users,
  AlertCircle,
  Calendar,
  Video,
} from 'lucide-react'
import KPICard from '../components/KPICard'
import HeroCard from '../components/HeroCard'
import StatusBadge from '../components/StatusBadge'
import DataTable from '../components/DataTable'
import { getDashboard } from '@/lib/api/dashboard'
import { getBookingsByAccount, getCalcomStats, type BookingRow, type CalcomStats } from '@/lib/api/member'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bookings: BookingRow[]; calcom: { connected: boolean; stats: CalcomStats | null } }

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDate(iso: string): string {
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

function statusDisplay(b: BookingRow): string {
  const now = Date.now()
  const t = new Date(b.scheduled_at).getTime()
  const s = (b.status ?? '').toLowerCase()
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled'
  if (s === 'no_show' || s === 'no-show') return 'No-Show'
  if (s === 'completed') return 'Completed'
  if (!Number.isNaN(t) && t >= now) return 'Upcoming'
  return 'Completed'
}

export default function AnalyticsClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dashboard = await getDashboard()
        if (cancelled) return
        const [bookings, calcomRes] = await Promise.all([
          getBookingsByAccount(dashboard.account.account_id).catch(() => []),
          getCalcomStats().catch(() => ({ ok: true, connected: false, stats: null })),
        ])
        if (!cancelled) setState({ status: 'ready', bookings, calcom: { connected: calcomRes.connected, stats: calcomRes.stats } })
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not load analytics',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') return <AnalyticsSkeleton />
  if (state.status === 'error') return <AnalyticsFallback message={state.message} />

  const { bookings, calcom } = state
  const now = Date.now()

  const total = bookings.length
  const completed = bookings.filter((b) => (b.status ?? '').toLowerCase() === 'completed').length
  const past = bookings.filter((b) => {
    const t = new Date(b.scheduled_at).getTime()
    return !Number.isNaN(t) && t < now
  })
  const noShows = bookings.filter((b) => {
    const s = (b.status ?? '').toLowerCase()
    return s === 'no_show' || s === 'no-show'
  }).length
  const completionRate = past.length > 0 ? Math.round((completed / past.length) * 100) : 0

  const kpis = [
    {
      label: 'Total Bookings',
      value: String(total),
      change: total === 0 ? 'None yet' : 'All time',
      trend: 'neutral' as const,
      icon: BarChart3,
    },
    {
      label: 'Completion Rate',
      value: past.length > 0 ? `${completionRate}%` : '—',
      change: past.length > 0 ? `${completed} of ${past.length} past` : 'No past sessions',
      trend: 'neutral' as const,
      icon: CheckCircle,
    },
    {
      label: 'No-Shows',
      value: String(noShows),
      change: noShows === 0 ? 'None' : 'All time',
      trend: 'neutral' as const,
      icon: XCircle,
    },
    {
      label: 'Past Sessions',
      value: String(past.length),
      change: 'Completed or elapsed',
      trend: 'neutral' as const,
      icon: Clock,
    },
  ]

  // 7-month rolling booking volume
  const bars: Array<{ label: string; value: number; max: number }> = []
  const today = new Date()
  const counts: number[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const nextMonth = new Date(today.getFullYear(), today.getMonth() - i + 1, 1)
    const c = bookings.filter((b) => {
      const t = new Date(b.scheduled_at).getTime()
      return !Number.isNaN(t) && t >= d.getTime() && t < nextMonth.getTime()
    }).length
    counts.push(c)
    bars.push({ label: MONTH_LABELS[d.getMonth()], value: c, max: 0 })
  }
  const maxCount = Math.max(1, ...counts)
  bars.forEach((b) => (b.max = maxCount))

  // Recent appointments — latest 5 by scheduled_at descending
  const recentAppointments = bookings
    .slice()
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())
    .slice(0, 5)

  const recentCount = counts[counts.length - 1] ?? 0
  const prevCount = counts[counts.length - 2] ?? 0
  const monthDiff = recentCount - prevCount

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Analytics</h1>
        <p className="mt-1 text-sm text-white/50">
          Booking volume, conversion, and appointment metrics.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KPICard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Booking Volume</h3>
          <p className="mt-1 text-sm text-white/50">Last 7 months</p>
          <div className="mt-6 flex items-end gap-3" style={{ height: 180 }}>
            {bars.map((bar, i) => (
              <div key={`${bar.label}-${i}`} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-[11px] text-white/50">{bar.value}</span>
                <div
                  className="w-full rounded-t-md overflow-hidden"
                  style={{ height: `${Math.max(4, (bar.value / bar.max) * 140)}px` }}
                >
                  <div className="h-full w-full bg-gradient-to-t from-brand-orange to-brand-amber opacity-80" />
                </div>
                <span className="text-[11px] text-white/40">{bar.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Completion Funnel</h3>
          <p className="mt-1 text-sm text-white/50">Booked to completed</p>
          <div className="mt-8 space-y-8">
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">Booked → Completed</span>
                <span className="font-semibold text-white">{completionRate}%</span>
              </div>
              <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">Past sessions without no-show</span>
                <span className="font-semibold text-white">
                  {past.length > 0 ? Math.round(((past.length - noShows) / past.length) * 100) : 0}%
                </span>
              </div>
              <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-orange to-brand-amber"
                  style={{
                    width: `${past.length > 0 ? Math.round(((past.length - noShows) / past.length) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <p className="mt-8 text-xs text-white/30">
            Inquiry-to-booking funnel is coming soon once inquiry tracking lands.
          </p>
        </div>
      </div>

      {/* Cal.com Booking Stats */}
      {calcom.connected && calcom.stats && (
        <div className="space-y-4">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Cal.com Bookings</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard
              label="Upcoming"
              value={String(calcom.stats.upcoming)}
              change="Scheduled"
              trend="neutral"
              icon={Calendar}
            />
            <KPICard
              label="Completed"
              value={String(calcom.stats.completed)}
              change="Past sessions"
              trend="neutral"
              icon={CheckCircle}
            />
            <KPICard
              label="Cancelled"
              value={String(calcom.stats.cancelled)}
              change={calcom.stats.total > 0 ? `${Math.round((calcom.stats.cancelled / calcom.stats.total) * 100)}% of total` : '—'}
              trend="neutral"
              icon={XCircle}
            />
            <KPICard
              label="No-Shows"
              value={String(calcom.stats.no_show)}
              change={calcom.stats.total > 0 ? `${Math.round((calcom.stats.no_show / calcom.stats.total) * 100)}% of total` : '—'}
              trend="neutral"
              icon={AlertCircle}
            />
          </div>
          {calcom.stats.by_event_type.length > 0 && (
            <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
              <h4 className="text-xs uppercase tracking-widest text-white/40">By Event Type</h4>
              <div className="mt-4 space-y-3">
                {calcom.stats.by_event_type
                  .sort((a, b) => b.count - a.count)
                  .map((et) => (
                    <div key={et.slug} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Video className="h-4 w-4 text-emerald-400" />
                        <span className="text-sm text-white/70">{et.label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-white/5">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.round((et.count / calcom.stats!.total) * 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium text-white">{et.count}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <h3 className="mb-4 text-xs uppercase tracking-widest text-white/40">Recent Appointments</h3>
        {recentAppointments.length === 0 ? (
          <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-10 text-center text-sm text-white/40">
            No appointments yet.
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'client', label: 'Client Name' },
              { key: 'service', label: 'Service Type' },
              { key: 'date', label: 'Date & Time' },
              { key: 'status', label: 'Status' },
            ]}
            rows={recentAppointments.map((a) => ({
              client: (
                <span className="font-medium text-white">
                  {a.client_name ?? a.client_email ?? '—'}
                </span>
              ),
              service: (a.booking_type ?? 'session').replace(/_/g, ' '),
              date: formatDate(a.scheduled_at),
              status: <StatusBadge status={statusDisplay(a)} />,
            }))}
          />
        )}
      </div>

      <HeroCard>
        <h3 className="text-xs uppercase tracking-widest text-brand-orange/70">Key Insights</h3>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-orange/10">
              <TrendingUp className="h-4 w-4 text-brand-orange" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {monthDiff >= 0 ? `+${monthDiff}` : monthDiff} bookings vs last month
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/50">
                {recentCount} this month, {prevCount} last month.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-orange/10">
              <CheckCircle className="h-4 w-4 text-brand-orange" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {past.length > 0 ? `${completionRate}% completion rate` : 'No past sessions yet'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/50">
                {completed} completed of {past.length} past sessions.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-orange/10">
              <Users className="h-4 w-4 text-brand-orange" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">{total} total bookings</p>
              <p className="mt-1 text-xs leading-relaxed text-white/50">All time across every client.</p>
            </div>
          </div>
        </div>
      </HeroCard>
    </div>
  )
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Analytics</h1>
        <p className="mt-1 text-sm text-white/50">Loading metrics…</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        <div className="h-64 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      </div>
    </div>
  )
}

function AnalyticsFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Analytics</h1>
        <p className="mt-1 text-sm text-white/50">
          Booking volume, conversion, and appointment metrics.
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
