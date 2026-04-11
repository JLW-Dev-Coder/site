'use client'

import { useEffect, useState } from 'react'
import {
  Coins,
  CalendarCheck,
  FileText,
  HeadphonesIcon,
  Video,
  RefreshCw,
  Plus,
  MessageSquare,
  Shield,
  AlertCircle,
} from 'lucide-react'
import KPICard from '../components/KPICard'
import HeroCard from '../components/HeroCard'
import ActivityItem from '../components/ActivityItem'
import { getDashboard } from '@/lib/api/dashboard'
import type { DashboardPayload } from '@/lib/api/types'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardPayload }

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const now = Date.now()
  const diffMs = now - then
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMemberSince(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function formatBookingTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function activityDotFor(type: string): string {
  if (type === 'report') return 'bg-emerald-400'
  if (type === 'booking') return 'bg-blue-400'
  if (type === 'support') return 'bg-white/30'
  return 'bg-brand-orange'
}

export default function DashboardClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    getDashboard()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', message: err?.message ?? 'Unknown error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return <DashboardSkeleton />
  }

  if (state.status === 'error') {
    return <DashboardFallback message={state.message} />
  }

  const { account, tokens, bookings, reports, support, activity } = state.data

  const kpis = [
    {
      label: 'Token Balance',
      value: String(tokens.balance),
      change: tokens.monthly_allocation > 0 ? `+${tokens.monthly_allocation}/mo` : 'No monthly allocation',
      trend: 'neutral' as const,
      icon: Coins,
    },
    {
      label: 'Bookings This Month',
      value: String(bookings.this_month),
      change: bookings.upcoming.length > 0 ? `${bookings.upcoming.length} upcoming` : 'No upcoming',
      trend: 'neutral' as const,
      icon: CalendarCheck,
    },
    {
      label: 'Reports Generated',
      value: String(reports.generated_this_month),
      change: 'This month',
      trend: 'neutral' as const,
      icon: FileText,
    },
    {
      label: 'Support Tickets',
      value: String(support.open_tickets),
      change: support.open_tickets > 0 ? 'Open' : 'None open',
      trend: 'neutral' as const,
      icon: HeadphonesIcon,
    },
  ]

  const nextBooking = bookings.upcoming[0] ?? null

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-white/50">
          Welcome back. Here&apos;s your operational overview.
        </p>
      </div>

      {/* Hero welcome card */}
      <HeroCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-orange/70">Welcome back</p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              {account.name}
              {account.credential ? `, ${account.credential}` : ''}
            </h2>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-white/60">
              <span>
                <span className="text-white/40">Tier:</span>{' '}
                <span className="font-medium text-brand-orange">{account.tier}</span>
              </span>
              <span>
                <span className="text-white/40">Plan:</span>{' '}
                <span className="text-white/80">{account.plan_name}</span>
              </span>
              {account.tier_renewal_date && (
                <span>
                  <span className="text-white/40">Renews:</span>{' '}
                  <span className="text-white/80">
                    {new Date(account.tier_renewal_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-brand-orange/60" />
            <div>
              <p className="text-[11px] uppercase tracking-widest text-white/40">Member since</p>
              <p className="text-sm font-medium text-white/80">{formatMemberSince(account.member_since) || '—'}</p>
            </div>
          </div>
        </div>
      </HeroCard>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KPICard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* Two-column grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Next Scheduled Session */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Next Scheduled Session</h3>
          {nextBooking ? (
            <>
              <div className="mt-4 space-y-2">
                <p className="text-lg font-semibold text-white">
                  {nextBooking.booking_type.replace(/_/g, ' ')}
                </p>
                <p className="text-sm text-white/60">Status: {nextBooking.status}</p>
                <p className="text-sm text-white/50">{formatBookingTime(nextBooking.scheduled_at)}</p>
              </div>
              <div className="mt-5 flex gap-3">
                <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white shadow transition hover:opacity-90">
                  <Video className="h-4 w-4" />
                  Join Now
                </button>
                <button className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10">
                  <RefreshCw className="h-4 w-4" />
                  Reschedule
                </button>
              </div>
            </>
          ) : (
            <div className="mt-4 text-sm text-white/50">
              No upcoming sessions scheduled.
            </div>
          )}
        </div>

        {/* Token Balance highlight */}
        <HeroCard>
          <h3 className="text-xs uppercase tracking-widest text-brand-orange/70">Token Balance</h3>
          <p className="mt-3 text-4xl font-bold text-white">{tokens.balance}</p>
          <p className="mt-1 text-sm text-white/50">Transcript tokens available</p>
          <div className="mt-2 text-xs text-white/40">
            Monthly allocation: {tokens.monthly_allocation} tokens
          </div>
          <button className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white shadow transition hover:opacity-90">
            <Plus className="h-4 w-4" />
            Refill Tokens
          </button>
        </HeroCard>
      </div>

      {/* Recent Activity */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Recent Activity</h3>
        <div className="mt-2 divide-y divide-[--member-border]">
          {activity.length === 0 ? (
            <p className="py-6 text-sm text-white/40">No recent activity.</p>
          ) : (
            activity.map((a, i) => (
              <ActivityItem
                key={i}
                title={a.title}
                timestamp={formatRelative(a.timestamp)}
                dotColor={activityDotFor(a.type)}
              />
            ))
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 sm:grid-cols-3">
        <button className="flex items-center gap-3 rounded-xl border border-brand-orange/20 bg-[--member-card] p-5 text-left transition hover:bg-[--member-card-hover] hover:border-brand-orange/40">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-orange/10">
            <CalendarCheck className="h-5 w-5 text-brand-orange" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">New Booking</p>
            <p className="text-xs text-white/40">Schedule a consultation</p>
          </div>
        </button>
        <button className="flex items-center gap-3 rounded-xl border border-brand-orange/20 bg-[--member-card] p-5 text-left transition hover:bg-[--member-card-hover] hover:border-brand-orange/40">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-orange/10">
            <FileText className="h-5 w-5 text-brand-orange" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Generate Report</p>
            <p className="text-xs text-white/40">Run an IRS transcript analysis</p>
          </div>
        </button>
        <button className="flex items-center gap-3 rounded-xl border border-brand-orange/20 bg-[--member-card] p-5 text-left transition hover:bg-[--member-card-hover] hover:border-brand-orange/40">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-orange/10">
            <MessageSquare className="h-5 w-5 text-brand-orange" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Contact Support</p>
            <p className="text-xs text-white/40">Open a support ticket</p>
          </div>
        </button>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-white/50">Loading your overview…</p>
      </div>
      <div className="h-32 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        <div className="h-48 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      </div>
      <div className="h-56 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
    </div>
  )
}

function DashboardFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-white/50">Welcome back.</p>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Could not load live data</p>
          <p className="mt-1 text-amber-200/70">{message}</p>
        </div>
      </div>
      <HeroCard>
        <p className="text-xs uppercase tracking-widest text-brand-orange/70">Welcome back</p>
        <h2 className="mt-1 text-xl font-semibold text-white">Member</h2>
        <p className="mt-2 text-sm text-white/60">Your dashboard will populate once the API is reachable.</p>
      </HeroCard>
    </div>
  )
}
