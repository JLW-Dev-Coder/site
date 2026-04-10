import type { Metadata } from 'next'
import {
  CalendarCheck,
  ExternalLink,
  Settings,
  Clock,
  CheckCircle,
  Video,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import StatusBadge from '../components/StatusBadge'
import DataTable from '../components/DataTable'

export const metadata: Metadata = { title: 'Calendar' }

/* ── placeholder data ──────────────────────────────────────────── */

const upcomingSessions = [
  {
    name: 'Tax Strategy Review',
    client: 'David Chen',
    date: 'Apr 11, 2026',
    time: '10:00 AM',
    duration: '45 min',
    dot: 'bg-brand-orange',
  },
  {
    name: 'IRS Transcript Analysis',
    client: 'Sarah Johnson',
    date: 'Apr 14, 2026',
    time: '2:00 PM',
    duration: '30 min',
    dot: 'bg-blue-400',
  },
  {
    name: 'Quarterly Review',
    client: 'Martinez LLC',
    date: 'Apr 16, 2026',
    time: '11:00 AM',
    duration: '60 min',
    dot: 'bg-emerald-400',
  },
]

const availability = [
  { day: 'Monday – Friday', hours: '9:00 AM – 5:00 PM' },
  { day: 'Saturday', hours: '10:00 AM – 1:00 PM' },
  { day: 'Sunday', hours: 'Unavailable' },
]

const bookings = [
  { client: 'David Chen', service: 'Tax Strategy Review', scheduled: 'Apr 11, 2026 · 10:00 AM', status: 'Confirmed' },
  { client: 'Sarah Johnson', service: 'IRS Transcript Analysis', scheduled: 'Apr 14, 2026 · 2:00 PM', status: 'Pending' },
  { client: 'Martinez LLC', service: 'Quarterly Review', scheduled: 'Apr 16, 2026 · 11:00 AM', status: 'Confirmed' },
  { client: 'Angela Torres', service: 'Form 2848 Filing', scheduled: 'Apr 18, 2026 · 9:00 AM', status: 'Pending' },
  { client: 'Robert Kim', service: 'Initial Consultation', scheduled: 'Apr 21, 2026 · 3:00 PM', status: 'Confirmed' },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function CalendarPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Calendar</h1>
        <p className="mt-1 text-sm text-white/50">
          Cal.com integration. Manage scheduling and availability.
        </p>
      </div>

      {/* Integration status hero card */}
      <HeroCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-orange/10">
              <CalendarCheck className="h-6 w-6 text-brand-orange" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Cal.com</h2>
                <StatusBadge status="Connected" />
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-sm text-white/50">
                <ExternalLink className="h-3.5 w-3.5" />
                <span>cal.com/jamie-williams-cpa</span>
              </div>
            </div>
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10">
            <Settings className="h-4 w-4" />
            Configure
          </button>
        </div>
      </HeroCard>

      {/* Two-column grid: upcoming sessions + availability */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming Sessions */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Upcoming Sessions</h3>
          <div className="mt-4 divide-y divide-[--member-border]">
            {upcomingSessions.map((s) => (
              <div key={s.name + s.date} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">{s.name}</p>
                  <p className="mt-0.5 text-xs text-white/50">{s.client}</p>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-white/40">
                    <span className="flex items-center gap-1">
                      <CalendarCheck className="h-3 w-3" />
                      {s.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {s.time} · {s.duration}
                    </span>
                  </div>
                </div>
                <button className="shrink-0 rounded-lg border border-brand-orange/20 p-2 text-brand-orange/60 transition hover:bg-brand-orange/10 hover:text-brand-orange">
                  <Video className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Your Availability */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Your Availability</h3>
          <div className="mt-4 space-y-0 divide-y divide-[--member-border]">
            {availability.map((a) => (
              <div key={a.day} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                <span className="text-sm text-white/70">{a.day}</span>
                <div className="flex items-center gap-2">
                  {a.hours === 'Unavailable' ? (
                    <StatusBadge status="Unavailable" />
                  ) : (
                    <>
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-sm text-white/60">{a.hours}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2.5 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10">
            <Settings className="h-4 w-4" />
            Update Availability
          </button>
        </div>
      </div>

      {/* Booking Management table */}
      <div>
        <h3 className="mb-4 text-xs uppercase tracking-widest text-white/40">Booking Management</h3>
        <DataTable
          columns={[
            { key: 'client', label: 'Client' },
            { key: 'service', label: 'Service Type' },
            { key: 'scheduled', label: 'Scheduled For' },
            { key: 'status', label: 'Status' },
            { key: 'actions', label: 'Actions' },
          ]}
          rows={bookings.map((b) => ({
            client: <span className="font-medium text-white">{b.client}</span>,
            service: b.service,
            scheduled: b.scheduled,
            status: <StatusBadge status={b.status} />,
            actions: (
              <div className="flex gap-3">
                <button className="text-xs font-medium text-brand-orange hover:text-brand-400 transition">
                  Manage
                </button>
                {b.status === 'Pending' && (
                  <button className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition">
                    Confirm
                  </button>
                )}
              </div>
            ),
          }))}
        />
      </div>
    </div>
  )
}
