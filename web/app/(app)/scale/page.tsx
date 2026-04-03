'use client'

import { useEffect, useState } from 'react'

interface QueueRecord {
  email: string
  slug: string
  name: string
  subject: string
  body: string
  queued_at?: string
  email_1_sent_at?: string
  email_2_sent_at?: string
  email_2_scheduled_for?: string
}

interface SendState {
  total_email1_sent?: number
  total_email2_sent?: number
  last_run?: string
  ramp_day?: number
  [key: string]: unknown
}

interface DashboardData {
  email1_queue: QueueRecord[]
  email2_queue: QueueRecord[]
  send_state: SendState
  fetched_at: string
}

export default function ScaleDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('https://api.virtuallaunch.pro/v1/scale/dashboard', { credentials: 'include' })
      .then(r => {
        if (r.status === 403) throw new Error('Not authorized')
        if (!r.ok) throw new Error('Failed to load')
        return r.json()
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-slate-400">Loading pipeline data...</div>
  if (error) return <div className="p-8 text-red-400">{error}</div>
  if (!data) return null

  const e1 = data.email1_queue || []
  const e2 = data.email2_queue || []
  const st = data.send_state || {}

  const e1Sent = e1.filter(r => r.email_1_sent_at).length
  const e1Pending = e1.length - e1Sent
  const e2Sent = e2.filter(r => r.email_2_sent_at).length
  const e2Scheduled = e2.filter(r => r.email_2_scheduled_for && !r.email_2_sent_at).length
  const e2Pending = e2.length - e2Sent - e2Scheduled

  const today = new Date().toISOString().split('T')[0]
  const sentToday = e1.filter(r => r.email_1_sent_at && r.email_1_sent_at.startsWith(today)).length
  const e2SentToday = e2.filter(r => r.email_2_sent_at && r.email_2_sent_at.startsWith(today)).length

  // Merge queues by slug for the table
  const bySlug: Record<string, { e1: QueueRecord | null; e2: QueueRecord | null }> = {}
  e1.forEach(r => { bySlug[r.slug] = { e1: r, e2: null } })
  e2.forEach(r => {
    if (bySlug[r.slug]) bySlug[r.slug].e2 = r
    else bySlug[r.slug] = { e1: null, e2: r }
  })
  const rows = Object.entries(bySlug).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">SCALE Pipeline</h1>
        <span className="text-xs text-slate-500">
          Fetched {new Date(data.fetched_at).toLocaleTimeString()}
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Total Prospects" value={String(e1.length)} />
        <Card label="Email 1 Sent" value={`${e1Sent} / ${e1.length}`} accent={e1Sent > 0} />
        <Card label="Email 2 Sent" value={`${e2Sent} / ${e2.length}`} accent={e2Sent > 0} />
        <Card label="Email 2 Scheduled" value={String(e2Scheduled)} />
      </div>

      {/* Today */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Email 1 Sent Today" value={String(sentToday)} />
        <Card label="Email 2 Sent Today" value={String(e2SentToday)} />
        <Card label="Email 1 Pending" value={String(e1Pending)} />
        <Card label="Email 2 Pending" value={String(e2Pending)} />
      </div>

      {/* Send state */}
      {Object.keys(st).length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Send State</div>
          <pre className="text-sm text-slate-300 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(st, null, 2)}
          </pre>
        </div>
      )}

      {/* Prospect table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <div className="p-4 border-b border-slate-800">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">All Prospects ({rows.length})</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Email 1</th>
                <th className="px-4 py-3">Email 2</th>
                <th className="px-4 py-3">Asset</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([slug, { e1: r1, e2: r2 }]) => (
                <tr key={slug} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-slate-200 whitespace-nowrap">{r1?.name || r2?.name || slug}</td>
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{r1?.email || r2?.email || '—'}</td>
                  <td className="px-4 py-3">
                    {r1?.email_1_sent_at
                      ? <span className="text-emerald-400 text-xs">Sent {shortDate(r1.email_1_sent_at)}</span>
                      : <span className="text-amber-400 text-xs">Pending</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    {r2?.email_2_sent_at
                      ? <span className="text-emerald-400 text-xs">Sent {shortDate(r2.email_2_sent_at)}</span>
                      : r2?.email_2_scheduled_for
                        ? <span className="text-blue-400 text-xs">Scheduled {r2.email_2_scheduled_for}</span>
                        : <span className="text-slate-500 text-xs">Waiting</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`https://transcript.taxmonitor.pro/asset/${slug}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal-400 hover:text-teal-300 text-xs underline"
                    >
                      View
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
    </div>
  )
}

function shortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}