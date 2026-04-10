'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Booking {
  id: number | string
  title: string
  status: string
  start: string
  end: string
  attendee_name: string
  attendee_email: string
  event_type_slug: string
  created_at: string
}

interface Counts {
  all: number
  cancelled: number
  completed: number
  confirmed: number
  pending: number
  rescheduled: number
  upcoming: number
}

interface EventType {
  slug: string
  label: string
}

type EventTypeMap = Record<string, EventType[]>

interface BookingsResponse {
  ok: boolean
  bookings: Booking[]
  counts: Counts
  event_types: EventTypeMap
  error?: string
}

type StatusFilter = 'all' | 'cancelled' | 'completed' | 'confirmed' | 'pending' | 'rescheduled' | 'upcoming'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STATUS_FILTERS: StatusFilter[] = ['all', 'cancelled', 'completed', 'confirmed', 'pending', 'rescheduled', 'upcoming']

const STATUS_BADGE: Record<string, string> = {
  accepted:    'bg-emerald-900/60 text-emerald-300',
  attended:    'bg-blue-900/60 text-blue-300',
  cancelled:   'bg-red-900/60 text-red-300',
  completed:   'bg-blue-900/60 text-blue-300',
  confirmed:   'bg-emerald-900/60 text-emerald-300',
  pending:     'bg-amber-900/60 text-amber-300',
  rescheduled: 'bg-amber-900/60 text-amber-300',
}

const PLATFORM_LABELS: Record<string, string> = {
  dvlp:  'DVLP \u2014 Developers Virtual Launch Pro',
  tcvlp: 'TCVLP \u2014 Tax Claim Virtual Launch Pro',
  tmp:   'TMP \u2014 Tax Monitor Pro',
  tttmp: 'TTTMP \u2014 Tax Tools Tax Monitor Pro',
  ttmp:  'TTMP \u2014 Transcript Tax Monitor Pro',
  vlp:   'VLP \u2014 Virtual Launch Pro',
}

function deriveStatus(b: Booking): string {
  const now = Date.now()
  const startMs = new Date(b.start).getTime()
  const endMs = new Date(b.end).getTime()
  if (b.status === 'cancelled') return 'cancelled'
  if (b.status === 'rescheduled') return 'rescheduled'
  if (b.status === 'pending') return 'pending'
  if ((b.status === 'accepted' || b.status === 'attended') && endMs < now) return 'completed'
  if (b.status === 'accepted' && startMs > now) return 'confirmed'
  if (startMs > now && b.status !== 'cancelled') return 'upcoming'
  return b.status
}

function matchesFilter(b: Booking, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  const derived = deriveStatus(b)
  if (filter === 'upcoming') {
    return new Date(b.start).getTime() > Date.now() && b.status !== 'cancelled'
  }
  return derived === filter
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function bookingMatchesEventType(b: Booking, et: EventType): boolean {
  if (b.event_type_slug && b.event_type_slug === et.slug) return true
  if (b.title && et.label && b.title.toLowerCase().includes(et.label.toLowerCase())) return true
  return false
}

// ---------------------------------------------------------------------------
// Skeleton components
// ---------------------------------------------------------------------------
function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-5 animate-pulse">
      <div className="h-3 w-24 rounded bg-slate-800 mb-3" />
      <div className="h-8 w-16 rounded bg-slate-800" />
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 animate-pulse">
      <div className="h-4 w-32 rounded bg-slate-800" />
      <div className="h-4 w-48 rounded bg-slate-800" />
      <div className="h-4 w-24 rounded bg-slate-800" />
      <div className="h-5 w-16 rounded-full bg-slate-800 ml-auto" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ScaleCalendarPage() {
  const [data, setData] = useState<BookingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('https://api.virtuallaunch.pro/v1/admin/bookings', { credentials: 'include' })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body.error || `API error ${res.status}`)
          return
        }
        const json = await res.json()
        if (!json.ok) {
          setError(json.error || 'Unknown error')
          return
        }
        setData(json)
      } catch {
        setError('Cal.com API not connected. Set CAL_API_KEY on the Worker.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const bookings = data?.bookings ?? []
  const counts = data?.counts ?? { all: 0, cancelled: 0, completed: 0, confirmed: 0, pending: 0, rescheduled: 0, upcoming: 0 }
  const eventTypes: EventTypeMap = data?.event_types ?? {}

  const filtered = bookings
    .filter(b => matchesFilter(b, filter))
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())

  const toggleCollapse = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  // KPI config
  const kpis: { key: keyof Counts; label: string; color: string }[] = [
    { key: 'all',       label: 'All',       color: 'text-white' },
    { key: 'upcoming',  label: 'Upcoming',  color: 'text-emerald-400' },
    { key: 'confirmed', label: 'Confirmed', color: 'text-emerald-400' },
    { key: 'pending',   label: 'Pending',   color: 'text-amber-400' },
    { key: 'completed', label: 'Completed', color: 'text-blue-400' },
    { key: 'cancelled', label: 'Cancelled', color: 'text-red-400' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Calendar</h1>
        <p className="mt-1 text-sm text-slate-400">Cal.com bookings across all platforms</p>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-8 text-center text-sm text-slate-500">
          {error}
        </div>
      )}

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
              filter === f
                ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/20'
                : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            {f} ({loading ? '\u2014' : counts[f as keyof Counts] ?? 0})
          </button>
        ))}
      </div>

      {/* KPI summary row */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : !error && (
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {kpis.map(k => (
            <div key={k.key} className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{k.label}</div>
              <div className={`mt-2 text-3xl font-bold ${k.color}`}>{counts[k.key]}</div>
            </div>
          ))}
        </div>
      )}

      {/* Event types grouped by platform */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-5 animate-pulse">
              <div className="h-4 w-48 rounded bg-slate-800 mb-4" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="h-20 rounded-lg bg-slate-800/40" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : !error && (
        <div className="space-y-4">
          {Object.entries(eventTypes).map(([platform, types]) => {
            const isCollapsed = collapsed[platform]
            const platformBookings = bookings.filter(b =>
              types.some(et => bookingMatchesEventType(b, et))
            )
            return (
              <div key={platform} className="rounded-xl border border-slate-800/60 bg-slate-950/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleCollapse(platform)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-900/40 transition"
                >
                  <div>
                    <span className="text-sm font-bold text-white">{PLATFORM_LABELS[platform] || platform.toUpperCase()}</span>
                    <span className="ml-3 text-xs text-slate-500">{platformBookings.length} booking{platformBookings.length !== 1 ? 's' : ''}</span>
                  </div>
                  <svg className={`h-4 w-4 text-slate-500 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!isCollapsed && (
                  <div className="px-5 pb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {types.map(et => {
                      const etBookings = bookings.filter(b => bookingMatchesEventType(b, et))
                      return (
                        <div key={et.slug} className="rounded-lg border border-slate-800/40 bg-slate-900/30 p-4">
                          <div className="text-sm font-semibold text-white">{et.label.replace(/^(.*?Virtual Launch Pro|.*?Tax Monitor Pro|.*?Tax Tools Tax Monitor Pro|.*?Transcript Tax Monitor Pro)\s*/, '')}</div>
                          <a
                            href={`https://cal.com/tax-monitor-pro/${et.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 block text-xs text-blue-400 hover:text-blue-300 truncate"
                          >
                            cal.com/tax-monitor-pro/{et.slug}
                          </a>
                          <div className="mt-3 flex items-center gap-3">
                            <span className="text-lg font-bold text-white">{etBookings.length}</span>
                            <span className="text-xs text-slate-500">booking{etBookings.length !== 1 ? 's' : ''}</span>
                          </div>
                          {etBookings.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(['confirmed', 'pending', 'completed', 'cancelled'] as const).map(s => {
                                const c = etBookings.filter(b => deriveStatus(b) === s).length
                                if (c === 0) return null
                                return (
                                  <span key={s} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[s] || 'bg-slate-800 text-slate-400'}`}>
                                    {c} {s}
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Bookings table */}
      <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800/60">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)} Bookings
          </span>
        </div>
        {loading ? (
          <div className="divide-y divide-slate-800/40">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No {filter === 'all' ? '' : filter + ' '}bookings
          </div>
        ) : (
          <div className="divide-y divide-slate-800/40">
            {filtered.map(b => {
              const derived = deriveStatus(b)
              return (
                <div key={b.id} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-900/40 transition text-sm">
                  <div className="w-44 shrink-0 text-slate-300">{formatDate(b.start)}</div>
                  <div className="min-w-0 flex-1 truncate text-white font-medium">{b.title}</div>
                  <div className="hidden md:block min-w-0 w-48 truncate text-slate-400">
                    {b.attendee_name}{b.attendee_email ? ` \u00B7 ${b.attendee_email}` : ''}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[derived] || STATUS_BADGE[b.status] || 'bg-slate-800 text-slate-400'}`}>
                    {derived}
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
