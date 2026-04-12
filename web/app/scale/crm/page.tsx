'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  email_1_sent_at?: unknown
  email_2_sent_at?: unknown
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

interface AdminStatsClient {
  account_id: string
  name: string
  email: string
  platform: string
  created_at: string
}

interface AdminStatsData {
  ok: boolean
  total_accounts?: number
  paid_accounts?: number
  clients?: AdminStatsClient[]
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

// Robust "is sent" check: handles boolean true, "true"/"True", ISO timestamps, Date objects.
function isSent(val: unknown): boolean {
  if (!val) return false
  if (val === true) return true
  if (val instanceof Date) return true
  if (typeof val === 'string') {
    const s = val.trim()
    if (!s) return false
    if (s.toLowerCase() === 'true') return true
    if (/^\d{4}-/.test(s)) return true // ISO date prefix
    return true // any non-empty timestamp-ish string counts as sent
  }
  return false
}

export default function ScaleCRMPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [stats, setStats] = useState<AdminStatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    setLoading(true)
    try {
      const [dashRes, statsRes] = await Promise.all([
        fetch('https://api.virtuallaunch.pro/v1/scale/dashboard', { credentials: 'include' }),
        fetch('https://api.virtuallaunch.pro/v1/admin/stats', { credentials: 'include' }),
      ])
      if (dashRes.ok) setData(await dashRes.json())
      if (statsRes.ok) setStats(await statsRes.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load CRM data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const lastBatch = data?.batch_history && data.batch_history.length > 0
    ? [...data.batch_history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    : null

  const sent1 = (data?.email1_queue ?? []).filter((r) => isSent(r.email_1_sent_at)).length
  const sent2 = (data?.email2_queue ?? []).filter((r) => isSent(r.email_2_sent_at)).length

  const paidTotal = stats?.paid_accounts ?? 0
  const platformCounts: Record<string, number> = {}
  for (const c of stats?.clients ?? []) {
    const key = (c.platform || '').toLowerCase()
    if (key) platformCounts[key] = (platformCounts[key] ?? 0) + 1
  }

  if (error && !loading && !data && !stats) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-white">CRM</h1>
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900 p-8 text-center">
          <p className="text-sm text-slate-400">Failed to load CRM data. {error}</p>
          <button
            onClick={load}
            className="mt-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">CRM</h1>
          <p className="mt-1 text-sm text-slate-400">Paid clients across all platforms</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/scale/crm/prospects"
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition"
          >
            FOIA Prospects
          </Link>
          <Link
            href="/scale"
            className="rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
          >
            Generate New Batch
          </Link>
        </div>
      </div>

      {/* Platform summary cards (clickable — navigate to client list) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => router.push('/scale/crm/clients')}
          className="text-left rounded-2xl border bg-slate-900 p-4 transition border-slate-800/60 hover:border-orange-500/60"
        >
          <div className="text-xs uppercase tracking-wide text-slate-400">All Clients</div>
          <div className="mt-2 text-3xl font-bold text-white">{(stats?.total_accounts ?? 0).toLocaleString()}</div>
          <div className="mt-1 text-xs text-slate-500">
            {paidTotal.toLocaleString()} Paid · {((stats?.total_accounts ?? 0) - paidTotal).toLocaleString()} Free
          </div>
        </button>
        {PLATFORMS.map((p) => {
          const count = platformCounts[p.key] ?? 0
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => router.push(`/scale/crm/clients?platform=${p.key}`)}
              className="text-left rounded-2xl border bg-slate-900 p-4 transition border-slate-800/60 hover:border-orange-500/60"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full bg-gradient-to-r ${p.color}`} />
                <div className="text-xs uppercase tracking-wide text-slate-400">{p.label}</div>
              </div>
              <div className="mt-2 text-2xl font-bold text-white">{count.toLocaleString()}</div>
              <div className="mt-1 text-xs text-slate-500">View clients →</div>
            </button>
          )
        })}
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
              <div className="mt-1 text-lg font-bold text-white">{(lastBatch.record_count ?? 0).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Email 1 Pushed</div>
              <div className="mt-1 text-lg font-bold text-white">{(lastBatch.email1_pushed ?? 0).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Asset Pages Pushed</div>
              <div className="mt-1 text-lg font-bold text-white">{(lastBatch.asset_pages_pushed ?? 0).toLocaleString()}</div>
            </div>
          </div>
        ) : (
          <div className="text-slate-500 py-4 text-center text-sm">No batches generated yet.</div>
        )}
      </Card>
    </div>
  )
}
