'use client'

import { useEffect, useState } from 'react'
import {
  CalendarCheck,
  ExternalLink,
  Settings,
  Clock,
  CheckCircle,
  Video,
  AlertCircle,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import StatusBadge from '../components/StatusBadge'
import DataTable from '../components/DataTable'
import { getDashboard } from '@/lib/api/dashboard'
import {
  getBookingsByAccount,
  getProfile,
  type BookingRow,
} from '@/lib/api/member'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      bookings: BookingRow[]
      calBookingUrl: string | null
      availability: Array<{ day: string; hours: string }>
    }

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function dotFor(idx: number): string {
  return ['bg-brand-orange', 'bg-blue-400', 'bg-emerald-400', 'bg-white/30'][idx % 4]
}

function statusDisplay(s: string | null | undefined): string {
  if (!s) return 'Pending'
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function parseAvailability(profile: Record<string, unknown> | null): Array<{ day: string; hours: string }> {
  if (!profile) return []
  const contact = (profile.contact ?? {}) as Record<string, unknown>
  const weekly = contact.weekly_availability as Record<string, { start?: string; end?: string; closed?: boolean }> | undefined
  if (!weekly) return []
  const days: Array<[string, string]> = [
    ['monday', 'Monday'],
    ['tuesday', 'Tuesday'],
    ['wednesday', 'Wednesday'],
    ['thursday', 'Thursday'],
    ['friday', 'Friday'],
    ['saturday', 'Saturday'],
    ['sunday', 'Sunday'],
  ]
  return days.map(([key, label]) => {
    const slot = weekly[key]
    if (!slot || slot.closed || !slot.start || !slot.end) {
      return { day: label, hours: 'Unavailable' }
    }
    return { day: label, hours: `${slot.start} – ${slot.end}` }
  })
}

export default function CalendarClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dashboard = await getDashboard()
        if (cancelled) return
        const accountId = dashboard.account.account_id
        const professionalId = dashboard.account.professional_id

        const [bookings, profile] = await Promise.all([
          getBookingsByAccount(accountId).catch(() => [] as BookingRow[]),
          professionalId ? getProfile(professionalId).catch(() => null) : Promise.resolve(null),
        ])

        const buttons = (profile?.buttons ?? {}) as Record<string, Record<string, unknown>>
        const calBookingUrl =
          (buttons.schedule_button?.cal_url as string | undefined) ??
          (profile?.cal_booking_url as string | undefined) ??
          null

        const availability = parseAvailability(profile)

        if (!cancelled) setState({ status: 'ready', bookings, calBookingUrl, availability })
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not load calendar',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') return <CalendarSkeleton />
  if (state.status === 'error') return <CalendarFallback message={state.message} />

  const { bookings, calBookingUrl, availability } = state
  const now = Date.now()
  const upcoming = bookings
    .filter((b) => {
      const t = new Date(b.scheduled_at).getTime()
      return !Number.isNaN(t) && t >= now
    })
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())

  const nextThree = upcoming.slice(0, 3)

  const tableRows = bookings
    .slice()
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())
    .slice(0, 10)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Calendar</h1>
        <p className="mt-1 text-sm text-white/50">
          Cal.com integration. Manage scheduling and availability.
        </p>
      </div>

      <HeroCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-orange/10">
              <CalendarCheck className="h-6 w-6 text-brand-orange" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Cal.com</h2>
                <StatusBadge status={calBookingUrl ? 'Connected' : 'Not connected'} />
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-sm text-white/50">
                {calBookingUrl ? (
                  <>
                    <ExternalLink className="h-3.5 w-3.5" />
                    <a
                      href={calBookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-white"
                    >
                      {calBookingUrl.replace(/^https?:\/\//, '')}
                    </a>
                  </>
                ) : (
                  <span>Add a Cal.com URL in your profile to enable scheduling</span>
                )}
              </div>
            </div>
          </div>
          <a
            href="/profile/onboarding"
            className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10"
          >
            <Settings className="h-4 w-4" />
            Configure
          </a>
        </div>
      </HeroCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Upcoming Sessions</h3>
          <div className="mt-4 divide-y divide-[--member-border]">
            {nextThree.length === 0 ? (
              <p className="py-6 text-sm text-white/40">No upcoming sessions scheduled.</p>
            ) : (
              nextThree.map((s, i) => (
                <div key={s.booking_id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotFor(i)}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">
                      {(s.booking_type ?? 'session').replace(/_/g, ' ')}
                    </p>
                    <p className="mt-0.5 text-xs text-white/50">{s.client_name ?? s.client_email ?? '—'}</p>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-white/40">
                      <span className="flex items-center gap-1">
                        <CalendarCheck className="h-3 w-3" />
                        {formatDate(s.scheduled_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(s.scheduled_at)}
                      </span>
                    </div>
                  </div>
                  <button className="shrink-0 rounded-lg border border-brand-orange/20 p-2 text-brand-orange/60 transition hover:bg-brand-orange/10 hover:text-brand-orange">
                    <Video className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Your Availability</h3>
          <div className="mt-4 space-y-0 divide-y divide-[--member-border]">
            {availability.length === 0 ? (
              <p className="py-6 text-sm text-white/40">
                Availability not set. Update your profile to show hours.
              </p>
            ) : (
              availability.map((a) => (
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
              ))
            )}
          </div>
          <a
            href="/profile/onboarding"
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2.5 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10"
          >
            <Settings className="h-4 w-4" />
            Update Availability
          </a>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-xs uppercase tracking-widest text-white/40">Booking Management</h3>
        {tableRows.length === 0 ? (
          <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-10 text-center text-sm text-white/40">
            No bookings yet. Share your Cal.com link to get started.
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'client', label: 'Client' },
              { key: 'service', label: 'Service Type' },
              { key: 'scheduled', label: 'Scheduled For' },
              { key: 'status', label: 'Status' },
              { key: 'actions', label: 'Actions' },
            ]}
            rows={tableRows.map((b) => ({
              client: <span className="font-medium text-white">{b.client_name ?? b.client_email ?? '—'}</span>,
              service: (b.booking_type ?? 'session').replace(/_/g, ' '),
              scheduled: `${formatDate(b.scheduled_at)} · ${formatTime(b.scheduled_at)}`,
              status: <StatusBadge status={statusDisplay(b.status)} />,
              actions: (
                <div className="flex gap-3">
                  <button className="text-xs font-medium text-brand-orange hover:text-brand-400 transition">
                    Manage
                  </button>
                </div>
              ),
            }))}
          />
        )}
      </div>
    </div>
  )
}

function CalendarSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Calendar</h1>
        <p className="mt-1 text-sm text-white/50">Loading bookings…</p>
      </div>
      <div className="h-28 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        <div className="h-64 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      </div>
      <div className="h-48 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
    </div>
  )
}

function CalendarFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Calendar</h1>
        <p className="mt-1 text-sm text-white/50">Cal.com integration.</p>
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
