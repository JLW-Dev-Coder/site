'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'

interface Prospect {
  slug: string
  first_name: string
  last_name: string
  firm: string
  city: string
  state: string
  profession: string
  email: string
  phone: string
  domain: string
  email_status: string
  campaign: string
  email_stage: string
  linkedin_url: string | null
}

interface SearchResponse {
  ok: boolean
  prospects: Prospect[]
  total: number
  filtered: number
  limit: number
  offset: number
}

const STATUS_COLORS: Record<string, string> = {
  valid: 'bg-emerald-500/20 text-emerald-400',
  unverified: 'bg-yellow-500/20 text-yellow-400',
  invalid: 'bg-red-500/20 text-red-400',
  risky: 'bg-orange-500/20 text-orange-400',
  no_mx: 'bg-slate-500/20 text-slate-400',
  pattern_match: 'bg-blue-500/20 text-blue-400',
  catch_all: 'bg-purple-500/20 text-purple-400',
}

const CAMPAIGN_COLORS: Record<string, string> = {
  ttmp: 'bg-purple-500/20 text-purple-400',
  vlp: 'bg-orange-500/20 text-orange-400',
  wlvlp: 'bg-teal-500/20 text-teal-400',
  none: 'bg-slate-500/20 text-slate-500',
}

const PAGE_SIZE = 50

export default function ProspectsPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
      setOffset(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const search = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (debouncedQuery) params.set('q', debouncedQuery)
      const res = await fetch(
        `https://api.virtuallaunch.pro/v1/admin/scale/prospects/search?${params}`,
        { credentials: 'include' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: SearchResponse = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [debouncedQuery, offset])

  useEffect(() => { search() }, [search])

  const totalPages = data ? Math.ceil(data.filtered / PAGE_SIZE) : 0
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">FOIA Prospects</h1>
          <p className="mt-1 text-sm text-slate-400">
            {data ? `${data.filtered.toLocaleString()} of ${data.total.toLocaleString()} prospects` : 'Loading...'}
          </p>
        </div>
        <Link
          href="/scale/crm"
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition"
        >
          Back to CRM
        </Link>
      </div>

      {/* Search bar */}
      <Card>
        <input
          type="text"
          placeholder="Search by name, firm, city, email, domain..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
      </Card>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results table */}
      <Card className="overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800/60 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Firm</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Credential</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Links</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
              )}
              {data && data.prospects.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No prospects found.</td></tr>
              )}
              {data?.prospects.map((p) => (
                <tr key={p.slug} className="border-b border-slate-800/40 hover:bg-slate-900/60 transition">
                  <td className="px-4 py-3">
                    <Link
                      href={`/scale/crm/prospects/${p.slug}`}
                      className="font-medium text-white hover:text-orange-400 transition"
                    >
                      {p.first_name} {p.last_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-400 max-w-[180px] truncate">{p.firm || '-'}</td>
                  <td className="px-4 py-3 text-slate-400">{[p.city, p.state].filter(Boolean).join(', ') || '-'}</td>
                  <td className="px-4 py-3 text-slate-400">{p.profession || '-'}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.email || '-'}</td>
                  <td className="px-4 py-3">
                    {p.email_status ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[p.email_status] || 'bg-slate-500/20 text-slate-400'}`}>
                        {p.email_status}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${CAMPAIGN_COLORS[p.campaign] || CAMPAIGN_COLORS.none}`}>
                      {p.campaign === 'none' ? '-' : p.campaign.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {p.linkedin_url && (
                        <a
                          href={p.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 transition"
                          title="LinkedIn search"
                        >
                          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z"/></svg>
                        </a>
                      )}
                      {p.domain && (
                        <a
                          href={`https://${p.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 hover:text-slate-300 transition"
                          title="Website"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-800/60 px-4 py-3">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
