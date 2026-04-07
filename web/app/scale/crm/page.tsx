'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'

interface Pipeline {
  total: number
  eligible: number
  exhausted: number
  days_remaining: number
}

interface BatchHistory {
  date: string
  record_count: number
  email1_pushed: number
  asset_pages_pushed: number
}

interface QueueRecord {
  email: string
  slug: string
  name: string
  email_1_sent_at?: string
  email_2_sent_at?: string
}

interface DashboardData {
  email1_queue?: QueueRecord[]
  email2_queue?: QueueRecord[]
  pipeline?: Pipeline
  batch_history?: BatchHistory[] | null
  responses?: {
    bookings?: { created: number; paid: number }
    purchases?: { count: number; total_revenue: number }
  }
}

const PLATFORMS = [
  { key: 'vlp', label: 'VLP', color: 'from-orange-500 to-amber-500' },
  { key: 'tmp', label: 'TMP', color: 'from-blue-500 to-cyan-500' },
  { key: 'ttmp', label: 'TTMP', color: 'from-purple-500 to-fuchsia-500' },
  { key: 'tttmp', label: 'TTTMP', color: 'from-green-500 to-emerald-500' },
  { key: 'dvlp', label: 'DVLP', color: 'from-pink-500 to-rose-500' },
  { key: 'gvlp', label: 'GVLP', color: 'from-yellow-500 to-orange-500' },
  { key: 'tcvlp', label: 'TCVLP', color: 'from-indigo-500 to-blue-500' },
  { key: 'wlvlp', label: 'WLVLP', color: 'from-teal-500 to-cyan-500' },
]

export default function ScaleCRMPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activePlatform, setActivePlatform] = useState<string>('all')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('https://api.virtuallaunch.pro/v1/scale/dashboard', { credentials: 'include' })
        if (res.ok) setData(await res.json())
      } catch {/* ignore */} finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const lastBatch = data?.batch_history && data.batch_history.length > 0
    ? [...data.batch_history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    : null

  const allQueue = [...(data?.email1_queue ?? []), ...(data?.email2_queue ?? [])]
  const sent1 = (data?.email1_queue ?? []).filter((r) => r.email_1_sent_at).length
  const sent2 = (data?.email2_queue ?? []).filter((r) => r.email_2_sent_at).length
  const totalSent = sent1 + sent2

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">CRM</h1>
          <p className="mt-1 text-sm text-slate-400">Prospect pipeline across all platforms</p>
        </div>
        <Link
          href="/scale"
          className="rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
        >
          Generate New Batch
        </Link>
      </div>

      {/* Platform summary cards (clickable) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => setActivePlatform('all')}
          className={`text-left rounded-2xl border bg-slate-900 p-4 transition ${
            activePlatform === 'all' ? 'border-orange-500/60' : 'border-slate-800/60 hover:border-slate-700'
          }`}
        >
          <div className="text-xs uppercase tracking-wide text-slate-400">All Clients</div>
          <div className="mt-2 text-3xl font-bold text-white">{(data?.pipeline?.total ?? 0).toLocaleString()}</div>
          <div className="mt-1 text-xs text-slate-500">Across all platforms</div>
        </button>
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setActivePlatform(p.key)}
            className={`text-left rounded-2xl border bg-slate-900 p-4 transition ${
              activePlatform === p.key ? 'border-orange-500/60' : 'border-slate-800/60 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full bg-gradient-to-r ${p.color}`} />
              <div className="text-xs uppercase tracking-wide text-slate-400">{p.label}</div>
            </div>
            <div className="mt-2 text-2xl font-bold text-white">{p.key === 'vlp' ? (data?.pipeline?.total ?? 0).toLocaleString() : '—'}</div>
            <div className="mt-1 text-xs text-slate-500">{p.key === 'vlp' ? 'live' : 'placeholder'}</div>
          </button>
        ))}
      </div>

      {/* Pipeline funnel */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Pipeline Funnel</div>
        {loading ? (
          <div className="text-slate-500 py-6 text-center text-sm">Loading…</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-5">
            <div>
              <div className="text-xs uppercase text-slate-500">Total</div>
              <div className="mt-1 text-2xl font-bold text-white">{(data?.pipeline?.total ?? 0).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Email 1 Sent</div>
              <div className="mt-1 text-2xl font-bold text-white">{sent1.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Email 2 Sent</div>
              <div className="mt-1 text-2xl font-bold text-white">{sent2.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Booked</div>
              <div className="mt-1 text-2xl font-bold text-white">{data?.responses?.bookings?.created ?? 0}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Converted</div>
              <div className="mt-1 text-2xl font-bold text-emerald-400">{(data?.responses?.bookings?.paid ?? 0) + (data?.responses?.purchases?.count ?? 0)}</div>
            </div>
          </div>
        )}
      </Card>

      {/* Last batch */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Latest Batch</div>
        {lastBatch ? (
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <div className="text-xs uppercase text-slate-500">Date</div>
              <div className="mt-1 text-lg font-bold text-white">{new Date(lastBatch.date).toLocaleDateString()}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Records</div>
              <div className="mt-1 text-lg font-bold text-white">{lastBatch.record_count.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Email 1 Pushed</div>
              <div className="mt-1 text-lg font-bold text-white">{lastBatch.email1_pushed.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Asset Pages Pushed</div>
              <div className="mt-1 text-lg font-bold text-white">{lastBatch.asset_pages_pushed.toLocaleString()}</div>
            </div>
          </div>
        ) : (
          <div className="text-slate-500 py-4 text-center text-sm">No batches generated yet.</div>
        )}
      </Card>

      {/* Client list */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">
          {activePlatform === 'all' ? 'All Clients' : `${activePlatform.toUpperCase()} Clients`} ({allQueue.length})
        </div>
        {activePlatform !== 'all' && activePlatform !== 'vlp' ? (
          <div className="text-slate-500 py-8 text-center text-sm">
            Per-platform client lists not yet wired. Add an admin endpoint to surface clients per platform.
          </div>
        ) : allQueue.length === 0 ? (
          <div className="text-slate-500 py-8 text-center text-sm">No prospects in pipeline.</div>
        ) : (
          <div className="divide-y divide-slate-800/60 max-h-96 overflow-y-auto">
            {allQueue.slice(0, 100).map((r, i) => (
              <div key={`${r.email}-${i}`} className="flex items-center justify-between px-2 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-white truncate">{r.name}</div>
                  <div className="text-xs text-slate-500 truncate">{r.email}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  {r.email_1_sent_at && <span className="rounded bg-emerald-900/60 px-2 py-0.5 text-emerald-300">E1</span>}
                  {r.email_2_sent_at && <span className="rounded bg-emerald-900/60 px-2 py-0.5 text-emerald-300">E2</span>}
                  {r.slug && (
                    <a href={`/asset/${r.slug}`} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:text-amber-300">
                      asset →
                    </a>
                  )}
                </div>
              </div>
            ))}
            {allQueue.length > 100 && (
              <div className="px-2 py-3 text-xs text-slate-500">+{allQueue.length - 100} more…</div>
            )}
          </div>
        )}
        <div className="mt-3 text-xs text-slate-600">
          Total emails sent: {totalSent.toLocaleString()}
        </div>
      </Card>
    </div>
  )
}
