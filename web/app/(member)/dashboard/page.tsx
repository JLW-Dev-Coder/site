import type { Metadata } from 'next'
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
} from 'lucide-react'
import KPICard from '../components/KPICard'
import HeroCard from '../components/HeroCard'
import ActivityItem from '../components/ActivityItem'

export const metadata: Metadata = { title: 'Dashboard' }

/* ── placeholder data ──────────────────────────────────────────── */

const kpis = [
  { label: 'Token Balance', value: '47', change: '+5 this month', trend: 'up' as const, icon: Coins },
  { label: 'Bookings This Month', value: '12', change: '+3 vs last month', trend: 'up' as const, icon: CalendarCheck },
  { label: 'Reports Generated', value: '8', change: '+2 this week', trend: 'up' as const, icon: FileText },
  { label: 'Support Tickets', value: '1', change: 'Open', trend: 'neutral' as const, icon: HeadphonesIcon },
]

const activities = [
  { title: 'IRS Transcript Report completed for Martinez LLC', timestamp: '2 hours ago', dot: 'bg-emerald-400' },
  { title: 'New booking confirmed — Initial Consultation with David Chen', timestamp: '5 hours ago', dot: 'bg-blue-400' },
  { title: 'Support ticket #TKT-4821 resolved', timestamp: 'Yesterday, 3:45 PM', dot: 'bg-white/30' },
  { title: '5 transcript tokens added from VLP Scale renewal', timestamp: 'Yesterday, 12:00 AM', dot: 'bg-brand-orange' },
  { title: 'Profile updated — added CPA credential badge', timestamp: 'Apr 8, 2026', dot: 'bg-brand-orange' },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function DashboardPage() {
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
            <h2 className="mt-1 text-xl font-semibold text-white">Jamie Williams, CPA</h2>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-white/60">
              <span>
                <span className="text-white/40">Tier:</span>{' '}
                <span className="font-medium text-brand-orange">Featured</span>
              </span>
              <span>
                <span className="text-white/40">Plan:</span>{' '}
                <span className="text-white/80">VLP Scale</span>
              </span>
              <span>
                <span className="text-white/40">Renews:</span>{' '}
                <span className="text-white/80">May 4, 2026</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-brand-orange/60" />
            <div>
              <p className="text-[11px] uppercase tracking-widest text-white/40">Member since</p>
              <p className="text-sm font-medium text-white/80">March 2026</p>
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
          <div className="mt-4 space-y-2">
            <p className="text-lg font-semibold text-white">Tax Strategy Review</p>
            <p className="text-sm text-white/60">David Chen — Chen & Associates</p>
            <p className="text-sm text-white/50">Tomorrow, Apr 11, 2026 · 10:00 AM · 45 min</p>
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
        </div>

        {/* Token Balance highlight */}
        <HeroCard>
          <h3 className="text-xs uppercase tracking-widest text-brand-orange/70">Token Balance</h3>
          <p className="mt-3 text-4xl font-bold text-white">47</p>
          <p className="mt-1 text-sm text-white/50">Transcript tokens available</p>
          <div className="mt-2 text-xs text-white/40">
            Monthly allocation: 5 tokens · Next refresh: May 4, 2026
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
          {activities.map((a, i) => (
            <ActivityItem key={i} title={a.title} timestamp={a.timestamp} dotColor={a.dot} />
          ))}
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
