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
  Link2,
  Unlink,
  Loader2,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import StatusBadge from '../components/StatusBadge'
import FullCalendar from '@/components/member/FullCalendar'
import { getDashboard } from '@/lib/api/dashboard'
import {
  getBookingsByAccount,
  getProfile,
  type BookingRow,
} from '@/lib/api/member'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      bookings: BookingRow[]
      calBookingUrl: string | null
      availability: Array<{ day: string; hours: string }>
      calcomConnected: boolean
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CalendarClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [dashboard, calcomStatus] = await Promise.all([
          getDashboard(),
          fetch(`${API_URL}/v1/calcom/status`, { credentials: 'include' })
            .then(r => r.json())
            .catch(() => ({ connected: false })),
        ])
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

        if (!cancelled) setState({
          status: 'ready',
          bookings,
          calBookingUrl,
          availability,
          calcomConnected: calcomStatus.connected ?? false,
        })
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

  async function handleDisconnectCalcom() {
    setDisconnecting(true)
    try {
      await fetch(`${API_URL}/v1/calcom/disconnect`, {
        method: 'POST',
        credentials: 'include',
      })
      setState(prev => prev.status === 'ready' ? { ...prev, calcomConnected: false } : prev)
    } catch { /* ignore */ }
    setDisconnecting(false)
  }

  // Check URL params for OAuth callback result
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('calcom') === 'connected') {
      setState(prev => prev.status === 'ready' ? { ...prev, calcomConnected: true } : prev)
      // Clean up URL
      const url = new URL(window.location.href)
      url.searchParams.delete('calcom')
      window.history.replaceState({}, '', url.pathname)
    }
  }, [])

  if (state.status === 'loading') return <CalendarSkeleton />
  if (state.status === 'error') return <CalendarFallback message={state.message} />

  const { bookings, calBookingUrl, availability, calcomConnected } = state
  const now = Date.now()
  const upcoming = bookings
    .filter((b) => {
      const t = new Date(b.scheduled_at).getTime()
      return !Number.isNaN(t) && t >= now
    })
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())

  const nextThree = upcoming.slice(0, 3)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Calendar</h1>
        <p className="mt-1 text-sm text-white/50">
          Unified view — Google Calendar, Cal.com bookings, and IRS deadlines.
        </p>
      </div>

      {/* Full-month calendar */}
      <FullCalendar calcomConnected={calcomConnected} />

      {/* Cal.com connection card */}
      <HeroCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-orange/10">
              <CalendarCheck className="h-6 w-6 text-brand-orange" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Cal.com</h2>
                <StatusBadge status={calcomConnected ? 'Connected' : 'Not connected'} />
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-sm text-white/50">
                {calcomConnected ? (
                  <>
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Your Cal.com bookings are synced to the calendar above</span>
                  </>
                ) : calBookingUrl ? (
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
                    <span className="text-white/30">|</span>
                    <span>Connect to sync bookings</span>
                  </>
                ) : (
                  <span>Connect your Cal.com account to sync bookings</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {calcomConnected ? (
              <button
                onClick={handleDisconnectCalcom}
                disabled={disconnecting}
                className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                {disconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Unlink className="h-4 w-4" />
                )}
                Disconnect
              </button>
            ) : (
              <div className="flex flex-col items-end gap-1.5">
                <a
                  href={`${API_URL}/v1/cal/oauth/start`}
                  className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10"
                >
                  <Link2 className="h-4 w-4" />
                  Connect Cal.com
                </a>
                <span className="text-[11px] text-white/30">
                  Don&apos;t have Cal.com?{' '}
                  <a
                    href="https://refer.cal.com/tax-monitor-pro-wltn"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/40 underline transition hover:text-white/60"
                  >
                    Sign up free
                  </a>
                </span>
              </div>
            )}
          </div>
        </div>
      </HeroCard>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming sessions */}
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

        {/* Availability */}
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

    </div>
  )
}

function CalendarSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Calendar</h1>
        <p className="mt-1 text-sm text-white/50">Loading calendar...</p>
      </div>
      <div className="h-[500px] animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      <div className="h-28 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        <div className="h-64 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      </div>
    </div>
  )
}

function CalendarFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Calendar</h1>
        <p className="mt-1 text-sm text-white/50">Unified calendar view.</p>
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
