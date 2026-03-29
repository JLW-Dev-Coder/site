'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface TranscriptJobEntry {
  job_id: string
  transcript_type: string
  tax_year: number | null
  status: 'completed' | 'processing' | 'failed' | 'pending'
  created_at: string
  completed_at: string | null
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

export default function TranscriptResultsPage() {
  const [jobs, setJobs] = useState<TranscriptJobEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchJobs = useCallback(async () => {
    try {
      // Get session to extract account_id
      const sessionRes = await fetch('https://api.virtuallaunch.pro/v1/auth/session', {
        credentials: 'include',
      })
      const sessionData = await sessionRes.json()
      if (!sessionData.ok) {
        setError('Session expired. Please sign in again.')
        return
      }

      const res = await fetch(
        `https://api.virtuallaunch.pro/v1/tools/transcript-parser/history/${sessionData.session.account_id}`,
        { credentials: 'include' }
      )
      const data = await res.json()
      if (data.ok) {
        setJobs(data.jobs ?? [])
      } else {
        setError(data.message ?? 'Failed to load history.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // Poll every 10s if any job is "processing"
  useEffect(() => {
    const hasProcessing = jobs.some((j) => j.status === 'processing')
    if (!hasProcessing) return

    const interval = setInterval(fetchJobs, 10_000)
    return () => clearInterval(interval)
  }, [jobs, fetchJobs])

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Transcript Results</h1>
          <p className="mt-1 text-sm text-slate-400">
            View your transcript parsing history and results.
          </p>
        </div>
        <Link
          href="/transcripts/submit"
          className="rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
        >
          New Submission
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-2xl border border-slate-800/60 bg-slate-900/60"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-800/40 bg-red-900/20 p-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-10 text-center">
          <p className="text-sm text-slate-500">No transcript jobs yet.</p>
          <Link
            href="/transcripts/submit"
            className="mt-4 inline-block rounded-xl border border-orange-500/40 px-4 py-2 text-sm font-semibold text-orange-400 hover:bg-orange-500/10 transition"
          >
            Submit your first transcript
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const status = STATUS_STYLES[job.status] ?? STATUS_STYLES.pending
            return (
              <Link
                key={job.job_id}
                href={`/transcripts/results/${job.job_id}`}
                className="block rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5 transition hover:border-orange-500/30 hover:bg-slate-900/80"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-white">
                        {TYPE_LABELS[job.transcript_type] ?? job.transcript_type}
                      </span>
                      {job.tax_year && (
                        <span className="text-xs text-slate-500">TY {job.tax_year}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {new Date(job.created_at).toLocaleString()} &middot; {job.job_id.slice(0, 12)}...
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
  )
}
