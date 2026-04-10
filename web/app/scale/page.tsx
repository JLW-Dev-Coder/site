'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import styles from './page.module.css'

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
function Tooltip({ text }: { text: string }) {
  return (
    <span className={styles.tooltip}>
      <span className={styles.tooltipIcon}>?</span>
      <span className={styles.tooltipText}>{text}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Types — SCALE Pipeline (existing /v1/scale/dashboard)
// ---------------------------------------------------------------------------
interface CampaignSent {
  total: number
  today: number
  yesterday: number
}

interface Pipeline {
  total: number
  eligible: number
  exhausted: number
  days_remaining: number
  queued: { ttmp: number; vlp: number; wlvlp: number; all: number }
  sent: { ttmp: CampaignSent; vlp: CampaignSent; wlvlp: CampaignSent; all: number }
  sent_by_email: {
    email_1_sent: number
    email_2_sent: number
    email_3_sent: number
    email_4_sent: number
    email_5_sent: number
    email_6_sent: number
    pending: number
  }
}

interface BatchHistory {
  date: string
  batch_size: number
  routed_ttmp: number
  routed_vlp: number
  routed_wlvlp: number
  queue_sizes: Record<string, number>
}

interface Responses {
  bookings: {
    created: number
    cancelled: number
    rescheduled: number
    paid: number
    no_show: number
  }
  purchases: {
    count: number
    total_revenue: number
  }
}

interface DashboardData {
  pipeline: Pipeline | null
  batch_history: BatchHistory[] | null
  responses: Responses
  fetched_at: string
}

// ---------------------------------------------------------------------------
// Types — Cloudflare analytics (/v1/admin/analytics/all)
// ---------------------------------------------------------------------------
interface PlatformAnalytics {
  domain: string
  shared_zone?: boolean
  shared_with?: string[]
  total_requests?: number
  page_views?: number
  unique_visitors?: number
  bandwidth_bytes?: number
  threats?: number
  cache_hit_ratio?: number
  error?: string
}

interface AllAnalyticsData {
  ok: boolean
  since: string
  until: string
  platforms: Record<string, PlatformAnalytics>
}

// ---------------------------------------------------------------------------
// Types — admin stats (/v1/admin/stats) — used for SALES section
// ---------------------------------------------------------------------------
interface AdminStats {
  ok?: boolean
  total_accounts?: number
  paid_accounts?: number
  memberships_by_tier?: Record<string, number>
  recent_transactions?: Array<{ id: string; amount: number }>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PLATFORM_ORDER = ['vlp', 'tmp', 'ttmp', 'tttmp', 'dvlp', 'gvlp', 'tcvlp', 'wlvlp'] as const
type PlatformKey = (typeof PLATFORM_ORDER)[number]

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  vlp: 'VLP',
  tmp: 'TMP',
  ttmp: 'TTMP',
  tttmp: 'TTTMP',
  dvlp: 'DVLP',
  gvlp: 'GVLP',
  tcvlp: 'TCVLP',
  wlvlp: 'WLVLP',
}

// VLP zone hosts vlp/dvlp/gvlp/tcvlp/wlvlp; TMP zone hosts tmp/ttmp/tttmp.
// Shared-zone subdomains share the parent's totals — pick one representative
// per zone when computing the "All Repos Summary" so we don't double-count.
const ZONE_REPS: PlatformKey[] = ['vlp', 'tmp']

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatNumber(n: number | undefined): string {
  return (n ?? 0).toLocaleString()
}

// ---------------------------------------------------------------------------
// Repo card
// ---------------------------------------------------------------------------
function RepoCard({ platform, data }: { platform: PlatformKey; data: PlatformAnalytics | undefined }) {
  const label = PLATFORM_LABELS[platform]
  const domain = data?.domain || ''
  const hasError = !!data?.error
  const cacheRatio = Math.max(0, Math.min(1, data?.cache_hit_ratio ?? 0))
  const threats = data?.threats ?? 0
  const sharedWith = (data?.shared_with || []).filter((d) => d !== domain)

  return (
    <Link href={`/scale/analytics/${platform}`} className={styles.repoCard}>
      <div className={styles.repoCardHeader}>
        <span className={styles.repoCardLabel}>{label}</span>
        <span className={styles.repoCardDomain}>{domain}</span>
      </div>

      {hasError ? (
        <div className={styles.repoCardError}>Analytics unavailable</div>
      ) : (
        <>
          <div className={styles.repoCardKpis}>
            <div className={styles.repoCardKpi}>
              <div className={styles.repoCardKpiValue}>{formatNumber(data?.page_views)}</div>
              <div className={styles.repoCardKpiLabel}>Page Views</div>
            </div>
            <div className={styles.repoCardKpi}>
              <div className={styles.repoCardKpiValue}>{formatNumber(data?.unique_visitors)}</div>
              <div className={styles.repoCardKpiLabel}>Uniques</div>
            </div>
            <div className={styles.repoCardKpi}>
              <div className={styles.repoCardKpiValue}>{formatNumber(data?.total_requests)}</div>
              <div className={styles.repoCardKpiLabel}>Requests</div>
            </div>
            <div className={styles.repoCardKpi}>
              <div className={styles.repoCardKpiValue}>{formatBytes(data?.bandwidth_bytes ?? 0)}</div>
              <div className={styles.repoCardKpiLabel}>Bandwidth</div>
            </div>
          </div>

          <div className={styles.repoCardCacheBar}>
            <div className={styles.repoCardCacheBarFill} style={{ width: `${(cacheRatio * 100).toFixed(0)}%` }} />
          </div>
          <div className={styles.repoCardCacheLabel}>
            Cache hit ratio: {(cacheRatio * 100).toFixed(0)}%
          </div>

          {threats > 0 && (
            <div className={styles.repoCardThreats}>{formatNumber(threats)} threats</div>
          )}

          {data?.shared_zone && sharedWith.length > 0 && (
            <div className={styles.repoCardSharedZone}>Zone shared with {sharedWith.join(', ')}</div>
          )}
        </>
      )}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
type Tab = 'all-repos' | 'pipeline'

export default function ScaleAnalyticsPage() {
  const [tab, setTab] = useState<Tab>('all-repos')

  // Pipeline data
  const [pipeline, setPipeline] = useState<DashboardData | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  // All-repos analytics
  const [allAnalytics, setAllAnalytics] = useState<AllAnalyticsData | null>(null)
  const [allAnalyticsError, setAllAnalyticsError] = useState<string | null>(null)
  const [allAnalyticsLoading, setAllAnalyticsLoading] = useState(true)

  // Admin stats (for SALES)
  const [stats, setStats] = useState<AdminStats | null>(null)

  // Cal.com bookings summary
  const [bookingCounts, setBookingCounts] = useState<{ upcoming: number; completed: number } | null>(null)

  const [refreshing, setRefreshing] = useState(false)

  const fetchPipeline = async () => {
    try {
      const res = await fetch('https://api.virtuallaunch.pro/v1/scale/dashboard', {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Failed to load pipeline data')
      const json = await res.json()
      setPipeline(json)
      setPipelineError(null)
    } catch (e) {
      setPipelineError(e instanceof Error ? e.message : 'Failed to load pipeline data')
    }
  }

  const fetchAllAnalytics = async () => {
    try {
      const res = await fetch('https://api.virtuallaunch.pro/v1/admin/analytics/all', {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Failed to load analytics')
      const json = await res.json()
      setAllAnalytics(json)
      setAllAnalyticsError(null)
    } catch (e) {
      setAllAnalyticsError(e instanceof Error ? e.message : 'Failed to load analytics')
    }
  }

  const fetchStats = async () => {
    try {
      const res = await fetch('https://api.virtuallaunch.pro/v1/admin/stats', {
        credentials: 'include',
      })
      if (!res.ok) return
      const json = await res.json()
      setStats(json)
    } catch {
      /* non-critical */
    }
  }

  const fetchBookings = async () => {
    try {
      const res = await fetch('https://api.virtuallaunch.pro/v1/admin/bookings', {
        credentials: 'include',
      })
      if (!res.ok) return
      const json = await res.json()
      if (json.ok && json.counts) {
        setBookingCounts({ upcoming: json.counts.upcoming, completed: json.counts.completed })
      }
    } catch {
      /* non-critical */
    }
  }

  useEffect(() => {
    const run = async () => {
      await Promise.allSettled([
        fetchPipeline().finally(() => setPipelineLoading(false)),
        fetchAllAnalytics().finally(() => setAllAnalyticsLoading(false)),
        fetchStats(),
        fetchBookings(),
      ])
    }
    run()
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.allSettled([fetchPipeline(), fetchAllAnalytics(), fetchStats(), fetchBookings()])
    setRefreshing(false)
  }

  // ---- Aggregated zone totals (no double-counting) -----------------------
  const summary = useMemo(() => {
    const platforms = allAnalytics?.platforms
    if (!platforms) {
      return { requests: 0, page_views: 0, uniques: 0, bytes: 0, threats: 0 }
    }
    let requests = 0
    let page_views = 0
    let uniques = 0
    let bytes = 0
    let threats = 0
    for (const rep of ZONE_REPS) {
      const p = platforms[rep]
      if (!p || p.error) continue
      requests += p.total_requests || 0
      page_views += p.page_views || 0
      uniques += p.unique_visitors || 0
      bytes += p.bandwidth_bytes || 0
      threats += p.threats || 0
    }
    return { requests, page_views, uniques, bytes, threats }
  }, [allAnalytics])

  // ------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------
  return (
    <div className="space-y-8">
      {/* Header + tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">SCALE Analytics</h1>
          <p className="mt-1 text-sm text-slate-400">
            {tab === 'all-repos'
              ? 'Cloudflare traffic across all 8 VLP repos'
              : 'Outreach pipeline metrics and live data'}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={styles.refreshButton}
        >
          {refreshing ? (
            <svg className={styles.spinner} viewBox="0 0 24 24">
              <circle className={styles.spinnerCircle} cx="12" cy="12" r="10" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Refresh
        </button>
      </div>

      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'all-repos'}
          className={`${styles.tabButton} ${tab === 'all-repos' ? styles.tabButtonActive : ''}`}
          onClick={() => setTab('all-repos')}
        >
          All Repos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pipeline'}
          className={`${styles.tabButton} ${tab === 'pipeline' ? styles.tabButtonActive : ''}`}
          onClick={() => setTab('pipeline')}
        >
          Pipeline
        </button>
      </div>

      {tab === 'all-repos' ? (
        <AllReposView
          loading={allAnalyticsLoading}
          error={allAnalyticsError}
          data={allAnalytics}
          summary={summary}
        />
      ) : (
        <PipelineView
          loading={pipelineLoading}
          error={pipelineError}
          data={pipeline}
          summary={summary}
          stats={stats}
          bookingCounts={bookingCounts}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// All Repos view — summary bar + repo cards grid only
// ---------------------------------------------------------------------------
function AllReposView({
  loading,
  error,
  data,
  summary,
}: {
  loading: boolean
  error: string | null
  data: AllAnalyticsData | null
  summary: { requests: number; page_views: number; uniques: number; bytes: number; threats: number }
}) {
  return (
    <>
      {/* Summary bar */}
      <Card className={styles.summaryCard}>
        <div className={styles.summaryHeader}>
          <div>
            <div className={styles.summaryTitle}>All Repos Summary</div>
            <div className={styles.summarySubtitle}>
              {data?.since && data?.until
                ? `${new Date(data.since).toLocaleDateString()} – ${new Date(data.until).toLocaleDateString()}`
                : 'Last 7 days'}{' '}
              · 2 unique zones (no double-count)
            </div>
          </div>
        </div>
        <div className={styles.summaryGrid}>
          <SummaryStat label="Page Views" value={formatNumber(summary.page_views)} />
          <SummaryStat label="Unique Visitors" value={formatNumber(summary.uniques)} />
          <SummaryStat label="Requests" value={formatNumber(summary.requests)} />
          <SummaryStat label="Bandwidth" value={formatBytes(summary.bytes)} />
          <SummaryStat
            label="Threats"
            value={formatNumber(summary.threats)}
            accent={summary.threats > 0 ? 'red' : undefined}
          />
        </div>
      </Card>

      {/* Repo cards */}
      {loading ? (
        <div className={styles.repoGrid}>
          {[...Array(8)].map((_, i) => (
            <div key={i} className={styles.repoSkeleton}></div>
          ))}
        </div>
      ) : error ? (
        <Card>
          <div className="text-slate-400 text-center py-8">{error}</div>
        </Card>
      ) : (
        <div className={styles.repoGrid}>
          {PLATFORM_ORDER.map((p) => (
            <RepoCard key={p} platform={p} data={data?.platforms?.[p]} />
          ))}
        </div>
      )}
    </>
  )
}

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: 'red' }) {
  return (
    <div className={styles.summaryStat}>
      <div className={`${styles.summaryStatValue} ${accent === 'red' ? styles.statusRed : ''}`}>{value}</div>
      <div className={styles.summaryStatLabel}>{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Glass card wrapper
// ---------------------------------------------------------------------------
function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`${styles.glassCard} ${className}`}>
      {children}
    </div>
  )
}

function GlassCardTitle({ children }: { children: React.ReactNode }) {
  return <div className={styles.glassCardTitle}>{children}</div>
}

function KpiNumber({ value, label, accent }: { value: string | number; label: string; accent?: 'green' | 'red' | 'yellow' }) {
  const accentClass = accent === 'green' ? styles.statusGreen : accent === 'red' ? styles.statusRed : accent === 'yellow' ? styles.statusYellow : ''
  return (
    <div className={styles.kpiBlock}>
      <div className={`${styles.kpiNumber} ${accentClass}`}>{value}</div>
      <div className={styles.kpiLabel}>{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Funnel bar component
// ---------------------------------------------------------------------------
function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className={styles.funnelRow}>
      <div className={styles.funnelLabel}>{label}</div>
      <div className={styles.funnelBarTrack}>
        <div
          className={styles.funnelBarFill}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className={styles.funnelValue}>{(value ?? 0).toLocaleString()}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pipeline view — Canva-style glass-card charts
// ---------------------------------------------------------------------------
function PipelineView({
  loading,
  error,
  data,
  summary,
  stats,
  bookingCounts,
}: {
  loading: boolean
  error: string | null
  data: DashboardData | null
  summary: { requests: number; page_views: number; uniques: number; bytes: number; threats: number }
  stats: AdminStats | null
  bookingCounts: { upcoming: number; completed: number } | null
}) {
  const memberships = stats?.paid_accounts ?? 0
  const purchases = data?.responses?.purchases?.count ?? 0
  const p = data?.pipeline
  const eligible = p?.eligible ?? 0
  const daysRemaining = p?.days_remaining ?? 0
  const queued = p?.queued?.all ?? 0
  const sentAll = p?.sent?.all ?? 0
  const sentEmail1 = p?.sent_by_email?.email_1_sent ?? 0
  const funnelMax = Math.max(eligible, queued, sentEmail1, 1)

  const sentToday = (p?.sent?.ttmp?.today ?? 0) + (p?.sent?.vlp?.today ?? 0) + (p?.sent?.wlvlp?.today ?? 0)
  const sentYesterday = (p?.sent?.ttmp?.yesterday ?? 0) + (p?.sent?.vlp?.yesterday ?? 0) + (p?.sent?.wlvlp?.yesterday ?? 0)

  const sortedBatches = data?.batch_history && data.batch_history.length > 0
    ? [...data.batch_history].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    : []

  // Per-email progress bar data
  const emailSteps = p?.sent_by_email
  const pendingCount = emailSteps?.pending ?? 0
  const stepData = [
    { label: 'Email 1', count: emailSteps?.email_1_sent ?? 0, color: '#3b82f6' },
    { label: 'Email 2', count: emailSteps?.email_2_sent ?? 0, color: '#6366f1' },
    { label: 'Email 3', count: emailSteps?.email_3_sent ?? 0, color: '#8b5cf6' },
    { label: 'Email 4', count: emailSteps?.email_4_sent ?? 0, color: '#a78bfa' },
    { label: 'Email 5', count: emailSteps?.email_5_sent ?? 0, color: '#c4b5fd' },
    { label: 'Email 6', count: emailSteps?.email_6_sent ?? 0, color: '#ddd6fe' },
  ]
  // Show non-cumulative counts for the bar (how many at exactly this step)
  const stepBar = stepData.map((s, i) => ({
    ...s,
    segment: Math.max(0, i < stepData.length - 1 ? s.count - stepData[i + 1].count : s.count),
  }))
  const barTotal = (stepData[0]?.count ?? 0) + pendingCount

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className={styles.skeletonCard}></div>
          ))}
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <Card>
        <div className="text-slate-400 text-center py-8">{error}</div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Row 1: EMAIL PIPELINE + BATCH HISTORY */}
      <div className="grid gap-6 sm:grid-cols-2">
        {/* Email Pipeline funnel */}
        <GlassCard>
          <GlassCardTitle>Email Pipeline</GlassCardTitle>
          <div className={styles.funnelContainer}>
            <FunnelBar label="Eligible" value={eligible} max={funnelMax} color="linear-gradient(to right, #f97316, #f59e0b)" />
            <FunnelBar label="Queued" value={queued} max={funnelMax} color="linear-gradient(to right, #3b82f6, #6366f1)" />
            <FunnelBar label="Sent" value={sentEmail1} max={funnelMax} color="linear-gradient(to right, #22c55e, #14b8a6)" />
          </div>
          <div className={styles.funnelStats}>
            <div className={styles.funnelStatItem}>
              <span className={styles.funnelStatLabel}>Days Remaining</span>
              <span className={`${styles.funnelStatValue} ${daysRemaining < 7 ? styles.statusRed : daysRemaining <= 14 ? styles.statusYellow : styles.statusGreen}`}>
                {daysRemaining}
              </span>
            </div>
            <div className={styles.funnelStatItem}>
              <span className={styles.funnelStatLabel}>Completed</span>
              <span className={styles.funnelStatValue}>{sentAll}</span>
            </div>
            <div className={styles.funnelStatItem}>
              <span className={styles.funnelStatLabel}>Pending</span>
              <span className={styles.funnelStatValue}>{pendingCount}</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span>Today: {sentToday}</span>
            <span>Yesterday: {sentYesterday}</span>
            <span className="text-slate-600">|</span>
            <span>TTMP: {p?.sent?.ttmp?.total ?? 0}</span>
            <span>VLP: {p?.sent?.vlp?.total ?? 0}</span>
            <span>WLVLP: {p?.sent?.wlvlp?.total ?? 0}</span>
          </div>
        </GlassCard>

        {/* Batch History table */}
        <GlassCard>
          <GlassCardTitle>Batch History</GlassCardTitle>
          {sortedBatches.length > 0 ? (
            <div className={styles.tableContainer}>
              <table className={styles.glassTable}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Batch</th>
                    <th>TTMP</th>
                    <th>VLP</th>
                    <th>WLVLP</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedBatches.map((batch, i) => (
                    <tr key={i}>
                      <td>{new Date(batch.date + 'T00:00:00').toLocaleDateString()}</td>
                      <td>{(batch.batch_size ?? 0).toLocaleString()}</td>
                      <td>{(batch.routed_ttmp ?? 0).toLocaleString()}</td>
                      <td>{(batch.routed_vlp ?? 0).toLocaleString()}</td>
                      <td>{(batch.routed_wlvlp ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.glassCardMuted}>No batches generated yet</div>
          )}
        </GlassCard>
      </div>

      {/* Row 1b: Per-email cadence progress */}
      {emailSteps && barTotal > 0 && (
        <GlassCard>
          <GlassCardTitle>Email Cadence Progress</GlassCardTitle>
          {/* Stacked horizontal bar */}
          <div className="flex h-6 rounded-md overflow-hidden bg-white/5 mt-2">
            {stepBar.map((s, i) => s.segment > 0 ? (
              <div
                key={i}
                title={`${s.label}: ${s.segment.toLocaleString()}`}
                style={{ width: `${(s.segment / barTotal) * 100}%`, backgroundColor: s.color }}
                className="transition-all duration-500"
              />
            ) : null)}
            {pendingCount > 0 && (
              <div
                title={`Pending: ${pendingCount.toLocaleString()}`}
                style={{ width: `${(pendingCount / barTotal) * 100}%` }}
                className="bg-slate-700 transition-all duration-500"
              />
            )}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-slate-400">
            {stepBar.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                {s.label}: {s.count.toLocaleString()}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-700" />
              Pending: {pendingCount.toLocaleString()}
            </span>
          </div>
        </GlassCard>
      )}

      {/* Row 2: PAGES + SALES */}
      <div className="grid gap-6 sm:grid-cols-2">
        <GlassCard>
          <GlassCardTitle>Site Analytics</GlassCardTitle>
          <div className={styles.kpiRow}>
            <KpiNumber value={formatNumber(summary.page_views)} label="Site Viewed" />
            <div className={styles.kpiBlock}>
              <div className={`${styles.kpiNumber} text-slate-600`}>0</div>
              <div className={styles.kpiLabel}>CTA Clicked</div>
              <div className={styles.kpiNote}>Requires per-event tracking in Worker</div>
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <GlassCardTitle>Revenue</GlassCardTitle>
          <div className={styles.kpiRow}>
            <KpiNumber value={formatNumber(memberships)} label="Memberships" accent={memberships > 0 ? 'green' : undefined} />
            <KpiNumber value={formatNumber(purchases)} label="Purchases" accent={purchases > 0 ? 'green' : undefined} />
          </div>
        </GlassCard>
      </div>

      {/* Row 3: BOOKINGS + FORMS */}
      <div className="grid gap-6 sm:grid-cols-2">
        <GlassCard>
          <GlassCardTitle>Bookings</GlassCardTitle>
          {bookingCounts ? (
            <div>
              <div className="flex gap-6 mb-4">
                <div>
                  <div className={`${styles.kpiNumber} text-emerald-400`} style={{ fontSize: '1.75rem' }}>{bookingCounts.upcoming}</div>
                  <div className={styles.kpiLabel}>Upcoming</div>
                </div>
                <div>
                  <div className={`${styles.kpiNumber} text-blue-400`} style={{ fontSize: '1.75rem' }}>{bookingCounts.completed}</div>
                  <div className={styles.kpiLabel}>Completed</div>
                </div>
              </div>
              <Link href="/scale/calendar" className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition">
                View all bookings &rarr;
              </Link>
            </div>
          ) : (
            <div className={styles.glassCardPlaceholder}>
              <svg className="w-8 h-8 text-slate-600 mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className={styles.glassCardMuted}>Loading booking data...</span>
            </div>
          )}
        </GlassCard>

        <GlassCard className={styles.glassCardDimmed}>
          <GlassCardTitle>Forms</GlassCardTitle>
          <div className={styles.glassCardPlaceholder}>
            <svg className="w-8 h-8 text-slate-600 mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className={styles.glassCardMuted}>No form submission tracking wired yet</span>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
