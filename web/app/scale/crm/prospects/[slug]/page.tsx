'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Card from '@/components/ui/Card'

interface Timestamps {
  email_found_at: string | null
  email_verified_at: string | null
  ttmp_email_1_prepared_at: string | null
  vlp_email_1_prepared_at: string | null
  wlvlp_email_1_prepared_at: string | null
  wlvlp_asset_enriched_at: string | null
  unsubscribed_at: string | null
}

interface ProspectData {
  slug: string
  first_name: string
  last_name: string
  full_name: string
  firm: string
  city: string
  state: string
  phone: string
  profession: string
  website: string
  domain_clean: string
  email_found: string
  email_status: string
  firm_bucket: string
  linkedin_url: string | null
  campaign: string
  email_stage: string
  timestamps: Timestamps
}

interface EmailSent {
  email_number: number
  subject: string
  body: string
  sent_at: string
  campaign: string
}

interface DetailResponse {
  ok: boolean
  prospect: ProspectData
  emails_sent: EmailSent[]
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

const CAMPAIGN_LABELS: Record<string, string> = {
  ttmp: 'TTMP — Transcript Monitor',
  vlp: 'VLP — Virtual Launch Pro',
  wlvlp: 'WLVLP — Website Lotto',
  none: 'Not routed',
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function ProspectDetailPage() {
  const params = useParams()
  const slug = params.slug as string
  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedEmail, setExpandedEmail] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `https://api.virtuallaunch.pro/v1/admin/scale/prospects/${encodeURIComponent(slug)}`,
        { credentials: 'include' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: DetailResponse = await res.json()
      if (!json.ok) throw new Error('Prospect not found')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prospect')
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-slate-500">Loading prospect...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <Link href="/scale/crm/prospects" className="text-sm text-slate-400 hover:text-white transition">
          &larr; Back to Prospects
        </Link>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <p className="text-sm text-red-400">{error || 'Prospect not found'}</p>
          <button onClick={load} className="mt-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const p = data.prospect
  const ts = p.timestamps

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/scale/crm/prospects" className="text-sm text-slate-400 hover:text-white transition">
        &larr; Back to Prospects
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-white">{p.full_name}</h1>
            {p.profession && (
              <span className="rounded-full bg-orange-500/20 px-2.5 py-0.5 text-xs font-bold text-orange-400">
                {p.profession}
              </span>
            )}
          </div>
          {p.firm && <p className="mt-1 text-sm text-slate-400">{p.firm}</p>}
          <p className="mt-0.5 text-sm text-slate-500">{[p.city, p.state].filter(Boolean).join(', ')}</p>
        </div>
        {ts.unsubscribed_at && (
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-400">
            Unsubscribed {formatDate(ts.unsubscribed_at)}
          </span>
        )}
      </div>

      {/* Contact Info */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Contact Information</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">Phone</div>
            <div className="mt-1">
              {p.phone ? (
                <a href={`tel:${p.phone}`} className="text-sm text-white hover:text-orange-400 transition">{p.phone}</a>
              ) : (
                <span className="text-sm text-slate-500">-</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Email</div>
            <div className="mt-1">
              {p.email_found ? (
                <div className="flex items-center gap-2">
                  <a href={`mailto:${p.email_found}`} className="text-sm text-white hover:text-orange-400 transition font-mono">{p.email_found}</a>
                  {p.email_status && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[p.email_status] || 'bg-slate-500/20 text-slate-400'}`}>
                      {p.email_status}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-sm text-slate-500">Not discovered</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Website</div>
            <div className="mt-1">
              {p.website ? (
                <a href={p.website.startsWith('http') ? p.website : `https://${p.website}`} target="_blank" rel="noopener noreferrer" className="text-sm text-white hover:text-orange-400 transition">
                  {p.domain_clean || p.website}
                </a>
              ) : (
                <span className="text-sm text-slate-500">-</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">LinkedIn</div>
            <div className="mt-1">
              {p.linkedin_url ? (
                <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:text-blue-300 transition">
                  Search on LinkedIn
                </a>
              ) : (
                <span className="text-sm text-slate-500">-</span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Pipeline Status */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Pipeline Status</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">Campaign</div>
            <div className="mt-1 text-sm text-white">{CAMPAIGN_LABELS[p.campaign] || p.campaign}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Email Stage</div>
            <div className="mt-1 text-sm text-white">{p.email_stage.replace(/_/g, ' ')}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Email Discovered</div>
            <div className="mt-1 text-sm text-slate-300">{formatDate(ts.email_found_at)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Email Verified</div>
            <div className="mt-1 text-sm text-slate-300">{formatDate(ts.email_verified_at)}</div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-4">
          <div>
            <div className="text-xs text-slate-500">TTMP Prepared</div>
            <div className="mt-1 text-sm text-slate-300">{formatDate(ts.ttmp_email_1_prepared_at)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">VLP Prepared</div>
            <div className="mt-1 text-sm text-slate-300">{formatDate(ts.vlp_email_1_prepared_at)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">WLVLP Prepared</div>
            <div className="mt-1 text-sm text-slate-300">{formatDate(ts.wlvlp_email_1_prepared_at)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">WLVLP Asset Enriched</div>
            <div className="mt-1 text-sm text-slate-300">{formatDate(ts.wlvlp_asset_enriched_at)}</div>
          </div>
        </div>
      </Card>

      {/* Asset page link for WLVLP */}
      {p.campaign === 'wlvlp' && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">WLVLP Asset Page</div>
              <p className="mt-1 text-sm text-slate-300">Conversion leak report for this prospect</p>
            </div>
            <a
              href={`https://websitelotto.virtuallaunch.pro/asset/${p.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 hover:from-teal-400 hover:to-cyan-400 transition"
            >
              View Asset Page
            </a>
          </div>
        </Card>
      )}

      {/* Email History */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">
          Email History {data.emails_sent.length > 0 && `(${data.emails_sent.length})`}
        </div>
        {data.emails_sent.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No emails sent yet.</p>
        ) : (
          <div className="space-y-2">
            {data.emails_sent.map((email) => (
              <div key={email.email_number} className="rounded-lg border border-slate-800/60 overflow-hidden">
                <button
                  onClick={() => setExpandedEmail(expandedEmail === email.email_number ? null : email.email_number)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-900/60 transition"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500/20 text-xs font-bold text-orange-400">
                      {email.email_number}
                    </span>
                    <div>
                      <div className="text-sm font-medium text-white">{email.subject || '(no subject)'}</div>
                      <div className="text-xs text-slate-500">{formatDate(email.sent_at)}</div>
                    </div>
                  </div>
                  <svg
                    className={`h-4 w-4 text-slate-500 transition-transform ${expandedEmail === email.email_number ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedEmail === email.email_number && (
                  <div className="border-t border-slate-800/60 bg-slate-950/60 px-4 py-4">
                    <pre className="whitespace-pre-wrap text-sm text-slate-300 font-sans leading-relaxed">
                      {email.body || '(no body)'}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
