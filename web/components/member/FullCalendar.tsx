'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  ExternalLink,
  X,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string
  title: string
  date: string       // YYYY-MM-DD
  start_time: string | null
  end_time: string | null
  all_day: boolean
  source: 'google' | 'calcom' | 'irs'
  color: string
  url: string
  description: string
  location?: string
}

interface CalendarApiResponse {
  ok: boolean
  google: { connected: boolean; events: CalendarEvent[] }
  calcom: { bookings: CalendarEvent[] }
  irs: { dates: CalendarEvent[] }
  merged: CalendarEvent[]
}

interface FullCalendarProps {
  brandColor?: string          // default: orange-500
  onConnectGoogle?: () => void // override the Google OAuth start action
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

const SOURCE_COLORS: Record<string, string> = {
  google: '#4285f4',
  calcom: '#292929',
  irs: '#dc2626',
}

const SOURCE_LABELS: Record<string, string> = {
  google: 'Google',
  calcom: 'Cal.com',
  irs: 'IRS',
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`
}

function formatMonthYear(y: number, m: number): string {
  return new Date(y, m).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function formatTime12(t: string | null): string {
  if (!t) return 'All day'
  const [h, min] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${pad2(min)} ${ampm}`
}

function getDaysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

function getFirstDayOfWeek(y: number, m: number): number {
  return new Date(y, m, 1).getDay()
}

// Build the 6-row grid of date cells for a month view
function buildMonthGrid(y: number, m: number): Array<{ day: number; key: string; inMonth: boolean }> {
  const firstDay = getFirstDayOfWeek(y, m)
  const daysInMonth = getDaysInMonth(y, m)
  const prevMonthDays = getDaysInMonth(y, m - 1)
  const cells: Array<{ day: number; key: string; inMonth: boolean }> = []

  // Leading days from previous month
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i
    const pm = m === 0 ? 11 : m - 1
    const py = m === 0 ? y - 1 : y
    cells.push({ day: d, key: dateKey(py, pm, d), inMonth: false })
  }

  // Days in current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, key: dateKey(y, m, d), inMonth: true })
  }

  // Trailing days from next month
  const remaining = 42 - cells.length // always show 6 rows
  const nm = m === 11 ? 0 : m + 1
  const ny = m === 11 ? y + 1 : y
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, key: dateKey(ny, nm, d), inMonth: false })
  }

  return cells
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FullCalendar({ brandColor, onConnectGoogle }: FullCalendarProps) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [googleConnected, setGoogleConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const accentColor = brandColor ?? 'rgb(249, 115, 22)' // orange-500

  const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate())

  // Fetch events when month changes
  const fetchEvents = useCallback(async (y: number, m: number) => {
    setLoading(true)
    setError(null)
    try {
      // Fetch a bit wider window so prev/next month cells show events too
      const start = dateKey(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1)
      const endMonth = m === 11 ? 0 : m + 1
      const endYear = m === 11 ? y + 1 : y
      const endDay = getDaysInMonth(endYear, endMonth)
      const end = dateKey(endYear, endMonth, endDay)

      const res = await fetch(`${API_URL}/v1/calendar/events?start=${start}&end=${end}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as CalendarApiResponse
      if (!data.ok) throw new Error('API error')
      setEvents(data.merged)
      setGoogleConnected(data.google.connected)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEvents(year, month)
  }, [year, month, fetchEvents])

  // Navigate months
  const goToday = () => {
    setYear(now.getFullYear())
    setMonth(now.getMonth())
    setSelectedDate(todayKey)
  }
  const goPrev = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const goNext = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  // Group events by date
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const e of events) {
      if (!map[e.date]) map[e.date] = []
      map[e.date].push(e)
    }
    return map
  }, [events])

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month])

  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] ?? []) : []

  const handleConnect = () => {
    if (onConnectGoogle) {
      onConnectGoogle()
    } else {
      window.location.href = `${API_URL}/v1/google/oauth/start`
    }
  }

  return (
    <div className="space-y-4">
      {/* Google connect banner */}
      {!loading && !googleConnected && (
        <div className="flex items-center justify-between rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-blue-300">
            <CalendarIcon className="h-4 w-4" />
            <span>Connect Google Calendar to see your events here</span>
          </div>
          <button
            onClick={handleConnect}
            className="rounded-md bg-[#4285f4] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#3367d6]"
          >
            Connect
          </button>
        </div>
      )}

      {/* Header: nav + month */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={goPrev}
            className="rounded-lg border border-[--member-border] p-2 text-white/60 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goNext}
            className="rounded-lg border border-[--member-border] p-2 text-white/60 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold text-white">{formatMonthYear(year, month)}</h2>
        </div>
        <button
          onClick={goToday}
          className="rounded-lg border border-[--member-border] px-3 py-1.5 text-sm text-white/60 transition hover:bg-white/5 hover:text-white"
        >
          Today
        </button>
      </div>

      {/* Calendar grid */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] overflow-hidden">
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 border-b border-[--member-border]">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="py-2 text-center text-xs font-medium uppercase tracking-wider text-white/40">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        {loading ? (
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }).map((_, i) => (
              <div key={i} className="h-24 border-b border-r border-[--member-border] animate-pulse bg-white/[0.01]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {grid.map((cell) => {
              const dayEvents = eventsByDate[cell.key] ?? []
              const isToday = cell.key === todayKey
              const isSelected = cell.key === selectedDate
              const hasIrs = dayEvents.some(e => e.source === 'irs')
              return (
                <button
                  key={cell.key}
                  onClick={() => setSelectedDate(isSelected ? null : cell.key)}
                  className={`
                    relative h-24 border-b border-r border-[--member-border] p-1.5 text-left transition
                    hover:bg-white/[0.03] focus:outline-none
                    ${!cell.inMonth ? 'opacity-30' : ''}
                    ${isSelected ? 'bg-white/[0.06] ring-1 ring-inset' : ''}
                  `}
                  style={isSelected ? { ringColor: accentColor } as React.CSSProperties : undefined}
                >
                  <span
                    className={`
                      inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium
                      ${isToday ? 'text-white' : 'text-white/60'}
                    `}
                    style={isToday ? { backgroundColor: accentColor } : undefined}
                  >
                    {cell.day}
                  </span>

                  {/* Event dots / pills */}
                  <div className="mt-0.5 space-y-0.5">
                    {dayEvents.slice(0, 3).map((evt) => (
                      <div
                        key={evt.id}
                        className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight"
                        style={{ backgroundColor: `${evt.color}20`, color: evt.color }}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: evt.color }}
                        />
                        <span className="truncate">{evt.title}</span>
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="px-1 text-[10px] text-white/40">+{dayEvents.length - 3} more</div>
                    )}
                  </div>

                  {/* IRS deadline indicator */}
                  {hasIrs && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Day detail panel */}
      {selectedDate && (
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </h3>
            <button
              onClick={() => setSelectedDate(null)}
              className="rounded-lg p-1 text-white/40 transition hover:bg-white/5 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="text-sm text-white/40">No events on this day.</p>
          ) : (
            <div className="space-y-3">
              {selectedEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-start gap-3 rounded-lg border border-[--member-border] bg-white/[0.02] p-3"
                >
                  <span
                    className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: evt.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{evt.title}</span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                        style={{
                          backgroundColor: `${SOURCE_COLORS[evt.source] ?? '#666'}20`,
                          color: SOURCE_COLORS[evt.source] ?? '#999',
                        }}
                      >
                        {SOURCE_LABELS[evt.source] ?? evt.source}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-white/50">
                      {evt.all_day
                        ? 'All day'
                        : `${formatTime12(evt.start_time)}${evt.end_time ? ` - ${formatTime12(evt.end_time)}` : ''}`}
                    </p>
                    {evt.description && (
                      <p className="mt-1 text-xs text-white/40 line-clamp-2">{evt.description}</p>
                    )}
                    {evt.url && (
                      <a
                        href={evt.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-5 text-xs text-white/40">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#4285f4' }} />
          Google
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#292929', border: '1px solid rgba(255,255,255,0.2)' }} />
          Cal.com
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#dc2626' }} />
          IRS Deadline
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-sm text-amber-300">
          {error}
        </div>
      )}
    </div>
  )
}
