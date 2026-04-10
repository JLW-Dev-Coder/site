import type { Metadata } from 'next'
import {
  FileText,
  CalendarCheck,
  Coins,
  ArrowDownRight,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import ActivityItem from '../components/ActivityItem'

export const metadata: Metadata = { title: 'Usage' }

/* ── placeholder data ──────────────────────────────────────────── */

const usageSummary = [
  { label: 'Reports Generated', value: '14', sub: '14 tokens used', icon: FileText },
  { label: 'Calendar Bookings', value: '8', sub: '8 tokens used', icon: CalendarCheck },
  { label: 'Tokens Remaining', value: '42', sub: '84% of budget', icon: Coins },
]

const consumptionBars = [
  { label: 'Report Generation', percent: 64, color: 'from-brand-orange to-brand-amber' },
  { label: 'Calendar Bookings', percent: 36, color: 'from-blue-500 to-blue-400' },
]

const recentEvents = [
  {
    title: 'IRS Transcript Analysis — Martinez LLC',
    tag: 'Report',
    tagColor: 'bg-brand-orange/10 text-brand-orange border-brand-orange/20',
    timestamp: 'Apr 8, 2026 · 2:45 PM',
    tokens: '-1',
    dot: 'bg-brand-orange',
  },
  {
    title: 'Initial Consultation — David Chen',
    tag: 'Booking',
    tagColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    timestamp: 'Apr 7, 2026 · 10:00 AM',
    tokens: '-1',
    dot: 'bg-blue-400',
  },
  {
    title: 'Form 2848 POA — Chen & Associates',
    tag: 'Report',
    tagColor: 'bg-brand-orange/10 text-brand-orange border-brand-orange/20',
    timestamp: 'Apr 5, 2026 · 4:12 PM',
    tokens: '-1',
    dot: 'bg-brand-orange',
  },
  {
    title: 'Tax Strategy Session — Thompson Trust',
    tag: 'Booking',
    tagColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    timestamp: 'Apr 3, 2026 · 11:30 AM',
    tokens: '-1',
    dot: 'bg-blue-400',
  },
  {
    title: 'Wage & Income Summary — Patel Group',
    tag: 'Report',
    tagColor: 'bg-brand-orange/10 text-brand-orange border-brand-orange/20',
    timestamp: 'Apr 1, 2026 · 3:20 PM',
    tokens: '-1',
    dot: 'bg-brand-orange',
  },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function UsagePage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Usage</h1>
        <p className="mt-1 text-sm text-white/50">
          Tool usage history and token consumption tracking.
        </p>
      </div>

      {/* Usage Summary hero */}
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

      {/* Token Consumption by Action */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Token Consumption by Action</h3>
        <div className="mt-5 space-y-5">
          {consumptionBars.map((bar) => (
            <div key={bar.label}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">{bar.label}</span>
                <span className="font-medium text-white">{bar.percent}%</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/5">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${bar.color} transition-all`}
                  style={{ width: `${bar.percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Tool Events */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Recent Tool Events</h3>
        <div className="mt-4 divide-y divide-[--member-border]">
          {recentEvents.map((evt, i) => (
            <div key={i} className="flex items-start gap-3 py-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${evt.dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-white/80">{evt.title}</p>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${evt.tagColor}`}>
                    {evt.tag}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-white/40">{evt.timestamp}</p>
              </div>
              <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-red-400">
                <ArrowDownRight className="h-3.5 w-3.5" />
                {evt.tokens}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
