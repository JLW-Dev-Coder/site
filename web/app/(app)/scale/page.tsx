'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import styles from './page.module.css'

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

interface DomainAnalytics {
  domain: string
  page_views?: number
  unique_visitors?: number
  bandwidth?: number
  error?: string
}

interface AnalyticsData {
  domains: DomainAnalytics[]
  fetched_at: string
}

export default function ScaleDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchDashboard = async () => {
    try {
      const response = await fetch('https://api.virtuallaunch.pro/v1/scale/dashboard', {
        credentials: 'include'
      })
      if (response.status === 403) throw new Error('Not authorized')
      if (!response.ok) throw new Error('Failed to load dashboard data')
      const result = await response.json()
      setData(result)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard data')
    }
  }

  const fetchAnalytics = async () => {
    try {
      const response = await fetch('https://api.virtuallaunch.pro/v1/scale/analytics', {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('Failed to load analytics data')
      const result = await response.json()
      setAnalytics(result)
      setAnalyticsError(null)
    } catch (e) {
      setAnalyticsError(e instanceof Error ? e.message : 'Failed to load analytics data')
    }
  }

  useEffect(() => {
    const loadData = async () => {
      await Promise.allSettled([
        fetchDashboard().finally(() => setLoading(false)),
        fetchAnalytics().finally(() => setAnalyticsLoading(false))
      ])
    }
    loadData()
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.allSettled([fetchDashboard(), fetchAnalytics()])
    setRefreshing(false)
  }

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

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
      <div className="space-y-8">
        <div className={styles.loadingSkeleton}>
          <div className={styles.skeletonTitle}></div>
          <div className={styles.skeletonSubtitle}></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className={styles.skeletonCard}></div>
          ))}
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.errorTitle}>Error loading dashboard</div>
        <div className={styles.errorMessage}>{error}</div>
        <button onClick={() => window.location.reload()} className={styles.retryButton}>
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-8">
      {/* Section 1: Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">SCALE Command Center</h1>
          <p className="mt-1 text-sm text-slate-400">
            Last fetched {new Date(data.fetched_at).toLocaleString()}
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

      {/* Section 2: Pipeline Overview */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Total Prospects
          </div>
          <div className="mt-2 text-3xl font-bold text-white">
            {data.pipeline.total.toLocaleString()}
          </div>
        </Card>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Eligible
          </div>
          <div className={`mt-2 text-3xl font-bold ${getPipelineAccentClass(data.pipeline.eligible, { red: 50, yellow: 100 })}`}>
            {data.pipeline.eligible.toLocaleString()}
          </div>
        </Card>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Exhausted
          </div>
          <div className="mt-2 text-3xl font-bold text-white">
            {data.pipeline.exhausted.toLocaleString()}
          </div>
        </Card>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Days Remaining
          </div>
          <div className={`mt-2 text-3xl font-bold ${getDaysRemainingAccentClass(data.pipeline.days_remaining)}`}>
            {data.pipeline.days_remaining}
          </div>
        </Card>
      </div>

      {/* Section 3: Send Queue Status */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Email 1 Queue
          </div>
          <div className="mt-2 text-3xl font-bold text-white">
            {data.email1_queue.length.toLocaleString()}
          </div>
          <div className="mt-4 space-y-2">
            {data.email1_queue.slice(0, 10).map((record, i) => (
              <div key={i} className={styles.queueRecord}>
                <span className="text-slate-200">{record.name}</span>
                <span className="text-xs text-slate-500">{record.email}</span>
                <span className={record.email_1_sent_at ? styles.statusSent : styles.statusPending}>
                  {record.email_1_sent_at ? 'Sent' : 'Pending'}
                </span>
              </div>
            ))}
            {data.email1_queue.length > 10 && (
              <div className="text-xs text-slate-500">+{data.email1_queue.length - 10} more</div>
            )}
          </div>
        </Card>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Email 2 Queue
          </div>
          <div className="mt-2 text-3xl font-bold text-white">
            {data.email2_queue.length.toLocaleString()}
          </div>
          <div className="mt-4 space-y-2">
            {data.email2_queue.slice(0, 10).map((record, i) => (
              <div key={i} className={styles.queueRecord}>
                <span className="text-slate-200">{record.name}</span>
                <span className="text-xs text-slate-500">{record.email}</span>
                <span className={record.email_2_sent_at ? styles.statusSent : record.email_2_scheduled_for ? styles.statusScheduled : styles.statusWaiting}>
                  {record.email_2_sent_at ? 'Sent' : record.email_2_scheduled_for ? 'Scheduled' : 'Waiting'}
                </span>
              </div>
            ))}
            {data.email2_queue.length > 10 && (
              <div className="text-xs text-slate-500">+{data.email2_queue.length - 10} more</div>
            )}
          </div>
        </Card>
      </div>

      {/* Section 4: Batch History */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">
          Batch History
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
                {[...data.batch_history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((batch, i) => (
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

      {/* Section 5: Response Tracking */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Bookings
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <div className="text-lg font-bold text-white">{data.responses.bookings.created}</div>
              <div className="text-xs text-slate-500">Created</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white">{data.responses.bookings.cancelled}</div>
              <div className="text-xs text-slate-500">Cancelled</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white">{data.responses.bookings.rescheduled}</div>
              <div className="text-xs text-slate-500">Rescheduled</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white">{data.responses.bookings.no_show}</div>
              <div className="text-xs text-slate-500">No Show</div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-800">
            <div className="text-2xl font-bold text-emerald-400">{data.responses.bookings.paid}</div>
            <div className="text-xs text-slate-400">Paid Conversions</div>
          </div>
        </Card>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Purchases
          </div>
          {data.responses.purchases.count > 0 ? (
            <div className="mt-4">
              <div className="text-2xl font-bold text-emerald-400">
                {formatCurrency(data.responses.purchases.total_revenue)}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {data.responses.purchases.count} purchase{data.responses.purchases.count !== 1 ? 's' : ''}
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

      {/* Section 6: Site Analytics */}
      <Card>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">
          Site Analytics
        </div>
        {analyticsLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className={styles.skeletonAnalyticsCard}></div>
            ))}
          </div>
        ) : analyticsError ? (
          <div className="text-slate-500 text-center py-8">Analytics unavailable</div>
        ) : analytics ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {analytics.domains.map((domain, i) => (
              <div key={i} className={styles.analyticsCard}>
                <div className="text-sm font-semibold text-white">{domain.domain}</div>
                {domain.error ? (
                  <div className="mt-2 text-xs text-red-400">Unavailable</div>
                ) : (
                  <div className="mt-2 space-y-1">
                    <div className="text-xs text-slate-400">
                      {(domain.page_views || 0).toLocaleString()} page views
                    </div>
                    <div className="text-xs text-slate-400">
                      {(domain.unique_visitors || 0).toLocaleString()} unique visitors
                    </div>
                    <div className="text-xs text-slate-400">
                      {formatBytes(domain.bandwidth || 0)} bandwidth
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  )
}