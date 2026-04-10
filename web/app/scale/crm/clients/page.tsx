'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import Card from '@/components/ui/Card'

interface Client {
  account_id: string
  name: string
  email: string
  platform: string
  created_at: string
  plan_key?: string | null
  membership_status?: string | null
}

interface StatsResponse {
  ok: boolean
  clients?: Client[]
}

const PLATFORMS = ['vlp', 'tmp', 'ttmp', 'tttmp', 'dvlp', 'gvlp', 'tcvlp', 'wlvlp']

const PLAN_LABELS: Record<string, string> = {
  vlp_free: 'Listed',
  vlp_starter: 'Active',
  vlp_scale: 'Featured',
  vlp_pro: 'Featured',
  vlp_advanced: 'Premier',
}

function membershipBadge(client: Client) {
  const status = client.membership_status
  const plan = client.plan_key
  if (status === 'active' && plan) {
    const label = PLAN_LABELS[plan] || plan
    return <span className="inline-block rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-400">Active — {label}</span>
  }
  if (status && status !== 'active' && plan) {
    return <span className="inline-block rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-400">{status.charAt(0).toUpperCase() + status.slice(1)}</span>
  }
  return <span className="inline-block rounded-full bg-slate-500/20 px-2 py-0.5 text-xs font-semibold text-slate-500">Free</span>
}

type SortKey = 'name' | 'created_at'
type SortDir = 'asc' | 'desc'

function ClientsListInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialPlatform = (searchParams.get('platform') || 'all').toLowerCase()

  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState<string>(initialPlatform)
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('https://api.virtuallaunch.pro/v1/admin/stats?include=clients', {
          credentials: 'include',
        })
        if (!res.ok) {
          setError(`HTTP ${res.status}`)
          return
        }
        const body: StatsResponse = await res.json()
        setClients(body.clients ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load clients')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = clients.slice()
    if (platform !== 'all') {
      rows = rows.filter((c) => (c.platform || '').toLowerCase() === platform)
    }
    if (q) {
      rows = rows.filter((c) => {
        const name = (c.name || '').toLowerCase()
        const email = (c.email || '').toLowerCase()
        return name.includes(q) || email.includes(q)
      })
    }
    rows.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '')
      } else {
        const ad = new Date(a.created_at || 0).getTime()
        const bd = new Date(b.created_at || 0).getTime()
        cmp = ad - bd
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [clients, platform, search, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'created_at' ? 'desc' : 'asc')
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/scale/crm" className="text-xs text-slate-400 hover:text-orange-400">← Back to CRM</Link>
          <h1 className="mt-1 text-2xl font-semibold text-white">Clients</h1>
          <p className="mt-1 text-sm text-slate-400">{filtered.length.toLocaleString()} of {clients.length.toLocaleString()} accounts</p>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500 focus:outline-none sm:max-w-xs"
          />
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
          >
            <option value="all">All platforms</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{p.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-rose-400">Error: {error}</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">No clients match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2">
                    <button type="button" onClick={() => toggleSort('name')} className="hover:text-orange-400">
                      Client Name{sortIndicator('name')}
                    </button>
                  </th>
                  <th className="px-3 py-2">Platform</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">
                    <button type="button" onClick={() => toggleSort('created_at')} className="hover:text-orange-400">
                      Date Added{sortIndicator('created_at')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.account_id}
                    onClick={() => router.push(`/scale/crm/clients/${encodeURIComponent(c.account_id)}`)}
                    className="cursor-pointer border-b border-slate-800/60 hover:bg-slate-900/60"
                  >
                    <td className="px-3 py-3">
                      <div className="font-medium text-white">{c.name || '—'}</div>
                      <div className="text-xs text-slate-500">{c.email}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-300">{(c.platform || '').toUpperCase() || '—'}</td>
                    <td className="px-3 py-3">{membershipBadge(c)}</td>
                    <td className="px-3 py-3 text-slate-400">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

export default function ClientsListPage() {
  return (
    <Suspense fallback={<div className="py-8 text-center text-sm text-slate-500">Loading…</div>}>
      <ClientsListInner />
    </Suspense>
  )
}
