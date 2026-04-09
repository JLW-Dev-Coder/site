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
interface Pipeline {
  total: number
  eligible: number
  exhausted: number
  days_remaining: number
}

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
  status?: string
}

interface BatchHistory {
  date: string
  record_count: number
  email1_pushed: number
  asset_pages_pushed: number
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
  email1_queue: QueueRecord[]
  email2_queue: QueueRecord[]
  pipeline: Pipeline
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
// Collapsible metric section
// ---------------------------------------------------------------------------
interface MetricSectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function MetricSection({ title, defaultOpen = false, children }: MetricSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={styles.metricSection}>
      <button
        type="button"
        className={styles.metricSectionHeader}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.metricSectionTitle}>{title}</span>
        <span className={styles.metricSectionChevron} aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      {open && <div className={styles.metricSectionBody}>{children}</div>}
    </div>
  )
}

// Single label-value row used inside metric sections
function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.metricRow}>
      <span className={styles.metricRowLabel}>{label}</span>
      <span className={styles.metricRowValue}>{value}</span>
    </div>
  )
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

  useEffect(() => {
    const run = async () => {
      await Promise.allSettled([
        fetchPipeline().finally(() => setPipelineLoading(false)),
        fetchAllAnalytics().finally(() => setAllAnalyticsLoading(false)),
        fetchStats(),
      ])
    }
    run()
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.allSettled([fetchPipeline(), fetchAllAnalytics(), fetchStats()])
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
              : 'Email outreach pipeline + responses'}
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
          SCALE Pipeline
        </button>
      </div>

      {tab === 'all-repos' ? (
        <AllReposView
          loading={allAnalyticsLoading}
          error={allAnalyticsError}
          data={allAnalytics}
          summary={summary}
          pipeline={pipeline}
          stats={stats}
        />
      ) : (
        <PipelineView loading={pipelineLoading} error={pipelineError} data={pipeline} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// All Repos view
// ---------------------------------------------------------------------------
function AllReposView({
  loading,
  error,
  data,
  summary,
  pipeline,
  stats,
}: {
  loading: boolean
  error: string | null
  data: AllAnalyticsData | null
  summary: { requests: number; page_views: number; uniques: number; bytes: number; threats: number }
  pipeline: DashboardData | null
  stats: AdminStats | null
}) {
  // ---- SALES fallbacks ---------------------------------------------------
  const memberships = stats?.paid_accounts ?? 0
  const purchases = pipeline?.responses?.purchases?.count ?? 0

  // ---- EMAILS fallbacks --------------------------------------------------
  const latestBatch = pipeline?.batch_history && pipeline.batch_history.length > 0
    ? [...pipeline.batch_history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    : null
  const email1Sent = (pipeline?.email1_queue ?? []).filter((r) => r.email_1_sent_at).length
  const email1Queued = (pipeline?.email1_queue ?? []).length
  const email2Scheduled = (pipeline?.email2_queue ?? []).filter((r) => r.email_2_scheduled_for).length
  const email2Sent = (pipeline?.email2_queue ?? []).filter((r) => r.email_2_sent_at).length
  const eligible = pipeline?.pipeline?.eligible ?? 0
  const daysRemaining = pipeline?.pipeline?.days_remaining ?? 0

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

      {/* Metric hierarchy from test notes */}
      <div className={styles.metricSections}>
        <MetricSection title="BOOKINGS">
          <MetricRow label="ALL" value={0} />
          <MetricRow label="CANCELLED" value={pipeline?.responses?.bookings?.cancelled ?? 0} />
          <MetricRow label="COMPLETED" value={0} />
          <MetricRow label="CONFIRMED" value={0} />
          <MetricRow label="PENDING" value={0} />
          <MetricRow label="RESCHEDULED" value={pipeline?.responses?.bookings?.rescheduled ?? 0} />
          <MetricRow label="UPCOMING" value={0} />
          <div className={styles.metricNote}>No bookings endpoint wired yet</div>
        </MetricSection>

        <MetricSection title="EMAILS">
          <MetricRow label="BATCHES" value={pipeline?.batch_history?.length ?? 0} />
          <MetricRow label="BATCH DATE" value={latestBatch ? new Date(latestBatch.date).toLocaleDateString() : '—'} />
          <MetricRow label="RECORD COUNT" value={latestBatch?.record_count ?? 0} />
          <MetricRow label="EMAIL 1 PUSHED" value={latestBatch?.email1_pushed ?? 0} />
          <MetricRow label="ASSET PAGES PUSHED" value={latestBatch?.asset_pages_pushed ?? 0} />
          <MetricRow label="BOUNCED" value={0} />
          <MetricRow label="DAYS REMAINING" value={daysRemaining} />
          <MetricRow label="DELIVERED" value={email1Sent + email2Sent} />
          <MetricRow label="ELIGIBLE" value={eligible} />
          <MetricRow label="OPENED" value={0} />
          <MetricRow label="REPLIED" value={0} />
          <MetricRow label="QUEUED" value={email1Queued} />
          <MetricRow label="EMAIL 1" value={email1Queued} />
          <MetricRow label="EMAIL 2" value={(pipeline?.email2_queue ?? []).length} />
          <MetricRow label="SCHEDULED" value={email2Scheduled} />
          <MetricRow label="SENT" value={email1Sent + email2Sent} />
          <MetricRow label="SUCCESSFUL" value={email1Sent + email2Sent} />
          <MetricRow label="UNSUBSCRIBED" value={0} />
        </MetricSection>

        <MetricSection title="FORMS">
          <MetricRow label="SUBMITTED" value={0} />
          <div className={styles.metricNote}>No forms endpoint wired yet</div>
        </MetricSection>

        <MetricSection title="PAGES" defaultOpen>
          <MetricRow label="SITE VIEWED" value={formatNumber(summary.page_views)} />
          <MetricRow label="CTA CLICKED" value={0} />
          <div className={styles.metricNote}>SITE VIEWED = aggregate page views across both zones · CTA CLICKED requires per-event tracking</div>
        </MetricSection>

        <MetricSection title="SALES">
          <MetricRow label="MEMBERSHIPS" value={formatNumber(memberships)} />
          <MetricRow label="PURCHASES" value={formatNumber(purchases)} />
        </MetricSection>
      </div>
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
// SCALE Pipeline view (preserved from previous page)
// ---------------------------------------------------------------------------
function PipelineView({
  loading,
  error,
  data,
}: {
  loading: boolean
  error: string | null
  data: DashboardData | null
}) {
  const formatCurrencyLocal = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  const getPipelineAccentClass = (value: number, thresholds: { red: number; yellow: number }): string => {
    if (value < thresholds.red) return styles.statusRed
    if (value < thresholds.yellow) return styles.statusYellow
    return styles.statusGreen
  }

  const getDaysRemainingAccentClass = (days: number): string => {
    if (days < 7) return styles.statusRed
    if (days <= 14) return styles.statusYellow
    return styles.statusGreen
  }

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className={styles.skeletonCard}></div>
        ))}
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

  if (!data) return null

  return (
    <div className="space-y-8">
      {/* Pipeline overview */}
      {!data.pipeline ? (
        <Card>
          <div className="text-center py-8">
            <div className="text-slate-500 mb-2">Pipeline data unavailable</div>
            <div className="text-xs text-slate-600">Prospect CSV file not found or could not be parsed</div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
              Total Prospects
              <Tooltip text="Total rows in the master prospect CSV, including those with and without valid email addresses." />
            </div>
            <div className="mt-2 text-3xl font-bold text-white">
              {(data.pipeline?.total ?? 0).toLocaleString()}
            </div>
          </Card>

          <Card>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
              Eligible
              <Tooltip text="Prospects with a valid email address who haven't had Email 1 prepared yet. These are available for the next batch." />
            </div>
            <div className={`mt-2 text-3xl font-bold ${getPipelineAccentClass(data.pipeline?.eligible ?? 0, { red: 50, yellow: 100 })}`}>
              {(data.pipeline?.eligible ?? 0).toLocaleString()}
            </div>
          </Card>

          <Card>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
              Email 1 Prepared
              <Tooltip text="Prospects who have had Email 1 copy generated and queued for delivery. This count reflects batch generation, not confirmed sends." />
            </div>
            <div className="mt-2 text-3xl font-bold text-white">
              {(data.pipeline?.exhausted ?? 0).toLocaleString()}
            </div>
          </Card>

          <Card>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
              Days Remaining
              <Tooltip text="Estimated days until eligible prospects run out, based on generating 50 prospects per batch." />
            </div>
            <div className={`mt-2 text-3xl font-bold ${getDaysRemainingAccentClass(data.pipeline?.days_remaining ?? 0)}`}>
              {data.pipeline?.days_remaining ?? 0}
            </div>
          </Card>
        </div>
      )}

      {/* Send queue status */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Email 1 Queue
            <Tooltip text="Total Email 1 messages pushed to the R2 send queue across all batches. Includes pending, sent, and failed." />
          </div>
          <div className="mt-2 text-3xl font-bold text-white">
            {(data.email1_queue ?? []).length.toLocaleString()}
          </div>
          <div className="mt-4 space-y-2">
            {(data.email1_queue ?? []).length === 0 ? (
              <div className="text-slate-500 text-center py-4">No emails in queue</div>
            ) : (
              <>
                {(data.email1_queue ?? []).slice(0, 10).map((record, i) => (
                  <div key={i} className={styles.queueRecord}>
                    <span className="text-slate-200">{record.name}</span>
                    <span className="text-xs text-slate-500">{record.email}</span>
                    <span className={record.email_1_sent_at ? styles.statusSent : styles.statusPending}>
                      {record.email_1_sent_at ? 'Sent' : 'Pending'}
                    </span>
                  </div>
                ))}
                {(data.email1_queue ?? []).length > 10 && (
                  <div className="text-xs text-slate-500">+{(data.email1_queue ?? []).length - 10} more</div>
                )}
              </>
            )}
          </div>
        </Card>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Email 2 Queue
            <Tooltip text="Prospects scheduled for Email 2 follow-up, typically 2-3 days after Email 1 was sent." />
          </div>
          <div className="mt-2 text-3xl font-bold text-white">
            {(data.email2_queue ?? []).length.toLocaleString()}
          </div>
          <div className="mt-4 space-y-2">
            {(data.email2_queue ?? []).length === 0 ? (
              <div className="text-slate-500 text-center py-4">No emails in queue</div>
            ) : (
              <>
                {(data.email2_queue ?? []).slice(0, 10).map((record, i) => (
                  <div key={i} className={styles.queueRecord}>
                    <span className="text-slate-200">{record.name}</span>
                    <span className="text-xs text-slate-500">{record.email}</span>
                    <span className={record.email_2_sent_at ? styles.statusSent : record.email_2_scheduled_for ? styles.statusScheduled : styles.statusWaiting}>
                      {record.email_2_sent_at ? 'Sent' : record.email_2_scheduled_for ? 'Scheduled' : 'Waiting'}
                    </span>
                  </div>
                ))}
                {(data.email2_queue ?? []).length > 10 && (
                  <div className="text-xs text-slate-500">+{(data.email2_queue ?? []).length - 10} more</div>
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Batch history */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4 flex items-center gap-1">
          Batch History
          <Tooltip text="Log of all batch generation runs with record counts and R2 push status." />
        </div>
        {data.batch_history && data.batch_history.length > 0 ? (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Record Count</th>
                  <th>Email 1 Pushed</th>
                  <th>Asset Pages Pushed</th>
                </tr>
              </thead>
              <tbody>
                {[...(data.batch_history ?? [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((batch, i) => (
                  <tr key={i}>
                    <td>{new Date(batch.date).toLocaleDateString()}</td>
                    <td>{batch.record_count.toLocaleString()}</td>
                    <td>{batch.email1_pushed.toLocaleString()}</td>
                    <td>{batch.asset_pages_pushed.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-slate-500 text-center py-8">No batches generated yet</div>
        )}
      </Card>

      {/* Response tracking */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Bookings
            <Tooltip text="Cal.com discovery call bookings attributed to SCALE prospects via the slug parameter in booking URLs." />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <div className="text-lg font-bold text-white">{data.responses?.bookings?.created ?? 0}</div>
              <div className="text-xs text-slate-500">Created</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white">{data.responses?.bookings?.cancelled ?? 0}</div>
              <div className="text-xs text-slate-500">Cancelled</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white">{data.responses?.bookings?.rescheduled ?? 0}</div>
              <div className="text-xs text-slate-500">Rescheduled</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white">{data.responses?.bookings?.no_show ?? 0}</div>
              <div className="text-xs text-slate-500">No Show</div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-800">
            <div className="text-2xl font-bold text-emerald-400">{data.responses?.bookings?.paid ?? 0}</div>
            <div className="text-xs text-slate-400">Paid Conversions</div>
          </div>
        </Card>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Purchases
            <Tooltip text="Stripe token purchases attributed to SCALE prospects by matching the buyer's email to the prospect index." />
          </div>
          {(data.responses?.purchases?.count ?? 0) > 0 ? (
            <div className="mt-4">
              <div className="text-2xl font-bold text-emerald-400">
                {formatCurrencyLocal(data.responses?.purchases?.total_revenue ?? 0)}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {data.responses?.purchases?.count ?? 0} purchase{(data.responses?.purchases?.count ?? 0) !== 1 ? 's' : ''}
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <div className="text-lg font-bold text-slate-500">$0.00</div>
              <div className="text-xs text-slate-500">No SCALE-attributed purchases yet</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
