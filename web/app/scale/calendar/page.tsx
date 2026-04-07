'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'

interface Booking {
  bookingId: string
  bookingType: string
  scheduledAt: string
  durationMinutes?: number
  status: 'confirmed' | 'pending' | 'completed' | 'cancelled' | 'rescheduled'
  timezone: string
  clientName?: string
  clientEmail?: string
  description?: string
  meetingUrl?: string
}

const STATUS_PILL: Record<string, string> = {
  confirmed: 'bg-emerald-900/60 text-emerald-300',
  pending: 'bg-amber-900/60 text-amber-300',
  completed: 'bg-slate-800 text-slate-400',
  cancelled: 'bg-red-900/60 text-red-300',
  rescheduled: 'bg-blue-900/60 text-blue-300',
}

function formatBookingType(t: string): string {
  if (!t) return ''
  if (t === 'demo_intro') return 'Demo / Intro'
  if (t === 'support') return 'Support Call'
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function ScaleCalendarPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'upcoming' | Booking['status']>('upcoming')
  const [selected, setSelected] = useState<Booking | null>(null)
  const [scaleStats, setScaleStats] = useState<{ created: number; cancelled: number; rescheduled: number; paid: number; no_show: number } | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const sessionRes = await fetch('https://api.virtuallaunch.pro/v1/auth/session', { credentials: 'include' })
        if (sessionRes.ok) {
          const session = await sessionRes.json()
          const aid = session.session?.account_id ?? session.account_id
          if (aid) {
            const r = await fetch(`https://api.virtuallaunch.pro/v1/bookings/by-account/${aid}`, { credentials: 'include' })
            if (r.ok) {
              const data = await r.json()
              setBookings(Array.isArray(data) ? data : (data.bookings ?? []))
            }
          }
        }
        // SCALE attribution stats
        const dash = await fetch('https://api.virtuallaunch.pro/v1/scale/dashboard', { credentials: 'include' })
        if (dash.ok) {
          const data = await dash.json()
          if (data.responses?.bookings) setScaleStats(data.responses.bookings)
        }
      } catch {/* ignore */} finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const now = Date.now()
  const filtered = bookings.filter((b) => {
    if (filter === 'all') return true
    if (filter === 'upcoming') return new Date(b.scheduledAt).getTime() >= now && b.status !== 'cancelled'
    return b.status === filter
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Calendar</h1>
        <p className="mt-1 text-sm text-slate-400">Bookings and Cal.com schedule overview</p>
      </div>

      {/* SCALE booking stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Created</div>
          <div className="mt-2 text-3xl font-bold text-white">{scaleStats?.created ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cancelled</div>
          <div className="mt-2 text-3xl font-bold text-red-300">{scaleStats?.cancelled ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Rescheduled</div>
          <div className="mt-2 text-3xl font-bold text-blue-300">{scaleStats?.rescheduled ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Paid</div>
          <div className="mt-2 text-3xl font-bold text-emerald-300">{scaleStats?.paid ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">No Show</div>
          <div className="mt-2 text-3xl font-bold text-amber-300">{scaleStats?.no_show ?? 0}</div>
        </Card>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['upcoming', 'all', 'confirmed', 'pending', 'completed', 'cancelled', 'rescheduled'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
              filter === f ? 'bg-orange-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading bookings…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No bookings in this view.</div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {filtered.map((b) => {
              const date = new Date(b.scheduledAt)
              return (
                <button
                  key={b.bookingId}
                  type="button"
                  onClick={() => setSelected(b)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-900/60 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">{formatBookingType(b.bookingType)}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}
                        {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        {b.clientName && ` · ${b.clientName}`}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_PILL[b.status] || ''}`}>
                      {b.status}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800/60 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="text-base font-bold text-white">{formatBookingType(selected.bookingType)}</div>
                <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_PILL[selected.status] || ''}`}>
                  {selected.status}
                </span>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-slate-500 hover:text-white transition">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3 text-sm text-slate-300">
              <div>
                <div className="text-xs uppercase text-slate-500">When</div>
                <div>{new Date(selected.scheduledAt).toLocaleString()} ({selected.timezone})</div>
              </div>
              {selected.clientName && (
                <div>
                  <div className="text-xs uppercase text-slate-500">Client</div>
                  <div>{selected.clientName}{selected.clientEmail && ` — ${selected.clientEmail}`}</div>
                </div>
              )}
              {selected.description && (
                <div>
                  <div className="text-xs uppercase text-slate-500">Notes</div>
                  <div className="whitespace-pre-wrap">{selected.description}</div>
                </div>
              )}
              {selected.meetingUrl && (
                <a href={selected.meetingUrl} target="_blank" rel="noopener noreferrer" className="block text-amber-400 hover:text-amber-300">
                  Join meeting →
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
