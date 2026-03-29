'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface TokenBalanceData {
  transcriptTokens: number
  taxGameTokens: number
}

interface RecentJob {
  job_id: string
  transcript_type: string
  tax_year: number | null
  status: 'completed' | 'processing' | 'failed' | 'pending'
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  account: 'Account Transcript',
  return: 'Return Transcript',
  wage_income: 'Wage & Income',
  record: 'Record of Account',
  record_of_account: 'Record of Account',
  wage_and_income: 'Wage & Income',
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  completed: { bg: 'bg-emerald-900/60', text: 'text-emerald-300', label: 'Completed' },
  processing: { bg: 'bg-amber-900/60', text: 'text-amber-300', label: 'Processing' },
  pending: { bg: 'bg-slate-700/60', text: 'text-slate-300', label: 'Pending' },
  failed: { bg: 'bg-red-900/60', text: 'text-red-300', label: 'Failed' },
}

export default function TranscriptsDashboardPage() {
  const [balance, setBalance] = useState<TokenBalanceData | null>(null)
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([])
  const [loading, setLoading] = useState(true)
  const [accountId, setAccountId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      // Get session
      const sessionRes = await fetch('https://api.virtuallaunch.pro/v1/auth/session', {
        credentials: 'include',
      })
      const sessionData = await sessionRes.json()
      if (!sessionData.ok) return

      const acctId = sessionData.session.account_id
      setAccountId(acctId)

      // Fetch balance and history in parallel
      const [balRes, histRes] = await Promise.all([
        fetch(`https://api.virtuallaunch.pro/v1/tokens/balance/${acctId}`, {
          credentials: 'include',
        }),
        fetch(`https://api.virtuallaunch.pro/v1/tools/transcript-parser/history/${acctId}`, {
          credentials: 'include',
        }),
      ])

      const balData = await balRes.json()
      if (balData.ok) {
        setBalance({
          transcriptTokens: balData.balance.transcriptTokens,
          taxGameTokens: balData.balance.taxGameTokens,
        })
      }

      const histData = await histRes.json()
      if (histData.ok) {
        setRecentJobs((histData.jobs ?? []).slice(0, 5))
      }
    } catch {
      // Fail silently on dashboard
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Poll if any jobs processing
  useEffect(() => {
    const hasProcessing = recentJobs.some((j) => j.status === 'processing')
    if (!hasProcessing) return
    const interval = setInterval(fetchData, 10_000)
    return () => clearInterval(interval)
  }, [recentJobs, fetchData])

  const totalJobs = recentJobs.length
  const completedJobs = recentJobs.filter((j) => j.status === 'completed').length
  const processingJobs = recentJobs.filter((j) => j.status === 'processing').length

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Transcript Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            Submit, monitor, and review transcript parsing jobs.
          </p>
        </div>
        <Link
          href="/transcripts/submit"
          className="rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
        >
          New Submission
        </Link>
      </div>

      {/* Token Balance + Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Transcript Tokens
          </span>
          {loading ? (
            <p className="mt-1 text-2xl font-bold text-slate-400">--</p>
          ) : (
            <p className="mt-1 text-2xl font-bold text-white">
              {balance?.transcriptTokens.toLocaleString() ?? 0}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Jobs Completed
          </span>
          <p className="mt-1 text-2xl font-bold text-emerald-400">
            {loading ? '--' : completedJobs}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Processing
          </span>
          <p className={`mt-1 text-2xl font-bold ${processingJobs > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
            {loading ? '--' : processingJobs}
          </p>
          {processingJobs > 0 && (
            <p className="mt-1 text-xs text-amber-400/70">Auto-refreshing every 10s</p>
          )}
        </div>
      </div>

      {/* Recent Jobs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Recent Jobs</h2>
          <Link href="/transcripts/results" className="text-xs text-orange-400 hover:underline">
            View all &rarr;
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl border border-slate-800/60 bg-slate-900/60" />
            ))}
          </div>
        ) : recentJobs.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-8 text-center">
            <p className="text-sm text-slate-500">No transcript jobs yet.</p>
            <Link
              href="/transcripts/submit"
              className="mt-3 inline-block text-sm text-orange-400 underline"
            >
              Submit your first transcript
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {recentJobs.map((job) => {
              const status = STATUS_STYLES[job.status] ?? STATUS_STYLES.pending
              return (
                <Link
                  key={job.job_id}
                  href={`/transcripts/results/${job.job_id}`}
                  className="block rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4 transition hover:border-orange-500/30"
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="text-sm font-semibold text-white">
                        {TYPE_LABELS[job.transcript_type] ?? job.transcript_type}
                      </span>
                      <p className="text-xs text-slate-500">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.bg} ${status.text}`}>
                      {status.label}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
