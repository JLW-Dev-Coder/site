import type { Metadata } from 'next'
import { BarChart3, CheckCircle, XCircle, Clock, Lightbulb, TrendingUp, Users } from 'lucide-react'
import KPICard from '../components/KPICard'
import HeroCard from '../components/HeroCard'
import StatusBadge from '../components/StatusBadge'
import DataTable from '../components/DataTable'

export const metadata: Metadata = { title: 'Analytics' }

/* ── placeholder data ──────────────────────────────────────────── */

const kpis = [
  { label: 'Total Bookings', value: '38', change: '+12% vs last month', trend: 'up' as const, icon: BarChart3 },
  { label: 'Completion Rate', value: '92%', change: '+4% improvement', trend: 'up' as const, icon: CheckCircle },
  { label: 'No-Shows', value: '3', change: '-2 vs last month', trend: 'up' as const, icon: XCircle },
  { label: 'Avg Session Length', value: '42m', change: 'Consistent', trend: 'neutral' as const, icon: Clock },
]

const barData = [
  { label: 'Oct', value: 18, max: 40 },
  { label: 'Nov', value: 24, max: 40 },
  { label: 'Dec', value: 15, max: 40 },
  { label: 'Jan', value: 30, max: 40 },
  { label: 'Feb', value: 27, max: 40 },
  { label: 'Mar', value: 35, max: 40 },
  { label: 'Apr', value: 38, max: 40 },
]

const funnelSteps = [
  { label: 'Inquiries → Bookings', value: 74, color: 'from-brand-orange to-brand-amber' },
  { label: 'Booked → Completed', value: 92, color: 'from-emerald-500 to-emerald-400' },
]

const appointments = [
  { client: 'David Chen', service: 'Tax Strategy Review', date: 'Apr 11, 2026 · 10:00 AM', duration: '45 min', status: 'Upcoming' },
  { client: 'Sarah Johnson', service: 'IRS Transcript Analysis', date: 'Apr 10, 2026 · 2:30 PM', duration: '30 min', status: 'Completed' },
  { client: 'Martinez LLC', service: 'Quarterly Review', date: 'Apr 9, 2026 · 11:00 AM', duration: '60 min', status: 'Completed' },
  { client: 'Angela Torres', service: 'Form 2848 Filing', date: 'Apr 8, 2026 · 9:00 AM', duration: '30 min', status: 'Cancelled' },
  { client: 'Robert Kim', service: 'Initial Consultation', date: 'Apr 7, 2026 · 3:00 PM', duration: '45 min', status: 'No-Show' },
]

const insights = [
  {
    icon: TrendingUp,
    title: 'Booking volume up 12%',
    description: 'Your April bookings are trending higher than any previous month. Tax season demand is peaking.',
  },
  {
    icon: CheckCircle,
    title: '92% completion rate',
    description: 'Well above the 85% platform average. Your confirmation reminders are working effectively.',
  },
  {
    icon: Users,
    title: '3 repeat clients this month',
    description: 'David Chen, Martinez LLC, and Sarah Johnson have booked multiple sessions. Consider offering a retainer package.',
  },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function AnalyticsPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Analytics</h1>
        <p className="mt-1 text-sm text-white/50">
          Booking volume, conversion, and appointment metrics.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KPICard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* Two-column grid: chart + funnel */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Booking Volume bar chart */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Booking Volume</h3>
          <p className="mt-1 text-sm text-white/50">Last 7 months</p>
          <div className="mt-6 flex items-end gap-3" style={{ height: 180 }}>
            {barData.map((bar) => (
              <div key={bar.label} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-[11px] text-white/50">{bar.value}</span>
                <div className="w-full rounded-t-md overflow-hidden" style={{ height: `${(bar.value / bar.max) * 140}px` }}>
                  <div className="h-full w-full bg-gradient-to-t from-brand-orange to-brand-amber opacity-80" />
                </div>
                <span className="text-[11px] text-white/40">{bar.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Conversion Funnel */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Conversion Funnel</h3>
          <p className="mt-1 text-sm text-white/50">Inquiry to completion</p>
          <div className="mt-8 space-y-8">
            {funnelSteps.map((step) => (
              <div key={step.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/70">{step.label}</span>
                  <span className="font-semibold text-white">{step.value}%</span>
                </div>
                <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${step.color}`}
                    style={{ width: `${step.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Appointments table */}
      <div>
        <h3 className="mb-4 text-xs uppercase tracking-widest text-white/40">Recent Appointments</h3>
        <DataTable
          columns={[
            { key: 'client', label: 'Client Name' },
            { key: 'service', label: 'Service Type' },
            { key: 'date', label: 'Date & Time' },
            { key: 'duration', label: 'Duration' },
            { key: 'status', label: 'Status' },
          ]}
          rows={appointments.map((a) => ({
            client: <span className="font-medium text-white">{a.client}</span>,
            service: a.service,
            date: a.date,
            duration: a.duration,
            status: <StatusBadge status={a.status} />,
          }))}
        />
      </div>

      {/* Key Insights hero card */}
      <HeroCard>
        <h3 className="text-xs uppercase tracking-widest text-brand-orange/70">Key Insights</h3>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          {insights.map((ins) => (
            <div key={ins.title} className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-orange/10">
                <ins.icon className="h-4.5 w-4.5 text-brand-orange" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{ins.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/50">{ins.description}</p>
              </div>
            </div>
          ))}
        </div>
      </HeroCard>
    </div>
  )
}
