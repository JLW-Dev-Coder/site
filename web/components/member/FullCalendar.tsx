'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  ExternalLink,
  X,
  Clock,
  MapPin,
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
  calcom: { connected: boolean; bookings: CalendarEvent[] }
  irs: { dates: CalendarEvent[] }
  merged: CalendarEvent[]
}

interface FullCalendarProps {
  brandColor?: string
  onConnectGoogle?: () => void
  calcomConnected?: boolean
  onConnectCalcom?: () => void
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

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins <= 0) return null
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function getDaysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

function getFirstDayOfWeek(y: number, m: number): number {
  return new Date(y, m, 1).getDay()
}

function buildMonthGrid(y: number, m: number): Array<{ day: number; key: string; inMonth: boolean }> {
  const firstDay = getFirstDayOfWeek(y, m)
  const daysInMonth = getDaysInMonth(y, m)
  const prevMonthDays = getDaysInMonth(y, m - 1)
  const cells: Array<{ day: number; key: string; inMonth: boolean }> = []

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i
    const pm = m === 0 ? 11 : m - 1
    const py = m === 0 ? y - 1 : y
    cells.push({ day: d, key: dateKey(py, pm, d), inMonth: false })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, key: dateKey(y, m, d), inMonth: true })
  }

  const remaining = 42 - cells.length
  const nm = m === 11 ? 0 : m + 1
  const ny = m === 11 ? y + 1 : y
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, key: dateKey(ny, nm, d), inMonth: false })
  }

  return cells
}

function formatLongDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FullCalendar({ brandColor, onConnectGoogle, calcomConnected: calcomConnectedProp, onConnectCalcom }: FullCalendarProps) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [googleConnected, setGoogleConnected] = useState(false)
  const [calcomConnected, setCalcomConnected] = useState(calcomConnectedProp ?? false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const accentColor = brandColor ?? 'rgb(249, 115, 22)'

  const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate())

  // Fetch events when month changes
  const fetchEvents = useCallback(async (y: number, m: number) => {
    setLoading(true)
    setError(null)
    try {
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
      if (data.calcom?.connected !== undefined) setCalcomConnected(data.calcom.connected)
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

  // Close panel on click outside
  useEffect(() => {
    if (!selectedDate) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Check if clicked on a calendar cell — let that toggle instead
        const target = e.target as HTMLElement
        if (target.closest('[data-calendar-cell]')) return
        setSelectedDate(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [selectedDate])

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

      {/* Calendar + slide-out panel wrapper */}
      <div className="relative flex">
        {/* Calendar grid */}
        <div className={`flex-1 rounded-xl border border-[--member-border] bg-[--member-card] overflow-hidden transition-all duration-300 ${selectedDate ? 'mr-[360px] lg:mr-[380px]' : ''}`}>
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
                    data-calendar-cell
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

        {/* Right slide-out panel */}
        <div
          ref={panelRef}
          className={`
            fixed right-0 top-0 z-50 h-full w-full bg-[#0a0e27] border-l border-[--member-border] shadow-2xl
            transition-transform duration-300 ease-in-out
            sm:w-[360px] lg:w-[380px]
            ${selectedDate ? 'translate-x-0' : 'translate-x-full'}
            lg:absolute lg:right-0 lg:top-0 lg:h-auto lg:min-h-full lg:rounded-xl lg:border lg:shadow-xl
          `}
        >
          {selectedDate && (
            <div className="flex h-full flex-col overflow-hidden lg:h-auto">
              {/* Panel header */}
              <div className="flex items-center justify-between border-b border-[--member-border] px-5 py-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {formatLongDate(selectedDate)}
                  </h3>
                  <p className="mt-0.5 text-xs text-white/40">
                    {selectedEvents.length} event{selectedEvents.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedDate(null)}
                  className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/5 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Panel body */}
              <div className="flex-1 overflow-y-auto p-5">
                {selectedEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <CalendarIcon className="mb-3 h-8 w-8 text-white/20" />
                    <p className="text-sm text-white/40">No events on this day.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedEvents.map((evt) => {
                      const duration = formatDuration(evt.start_time, evt.end_time)
                      return (
                        <div
                          key={evt.id}
                          className="group rounded-lg border border-[--member-border] bg-white/[0.02] p-4 transition hover:bg-white/[0.04]"
                        >
                          {/* Source badge + title */}
                          <div className="flex items-start gap-3">
                            <span
                              className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full"
                              style={{ backgroundColor: evt.color }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
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

                              {/* Time + duration */}
                              <div className="mt-2 flex items-center gap-3 text-xs text-white/50">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {evt.all_day
                                    ? 'All day'
                                    : `${formatTime12(evt.start_time)}${evt.end_time ? ` - ${formatTime12(evt.end_time)}` : ''}`}
                                </span>
                                {duration && (
                                  <span className="text-white/30">{duration}</span>
                                )}
                              </div>

                              {/* Location */}
                              {evt.location && (
                                <div className="mt-1.5 flex items-center gap-1 text-xs text-white/40">
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{evt.location}</span>
                                </div>
                              )}

                              {/* Description */}
                              {evt.description && (
                                <p className="mt-2 text-xs text-white/40 line-clamp-3">{evt.description}</p>
                              )}

                              {/* Action link */}
                              {evt.url && (
                                <a
                                  href={evt.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2.5 inline-flex items-center gap-1 rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-blue-400 transition hover:bg-white/10 hover:text-blue-300"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  {evt.source === 'google' ? 'Open in Google Calendar' : evt.source === 'calcom' ? 'Open in Cal.com' : 'Details'}
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

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
