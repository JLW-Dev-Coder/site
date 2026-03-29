'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface TranscriptDetail {
  jobId: string
  transcriptType: string
  taxYear: number | null
  status: string
  tokensDebited: number
  createdAt: string
  completedAt: string | null
  result: {
    parsedAt: string
    extractedFields: {
      tins: string[]
      dates: string[]
      amounts: string[]
      cycles: string[]
      accountBalance: string | null
      withheld: string | null
    }
    lineCount: number
    charCount: number
  } | null
}

const TYPE_LABELS: Record<string, string> = {
  account: 'Account Transcript',
  return: 'Return Transcript',
  wage_income: 'Wage & Income',
  record: 'Record of Account',
  record_of_account: 'Record of Account',
  wage_and_income: 'Wage & Income',
}

export default function TranscriptResultDetailPage() {
  const { event_id } = useParams<{ event_id: string }>()
  const [detail, setDetail] = useState<TranscriptDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchDetail() {
      try {
        const res = await fetch(
          `https://api.virtuallaunch.pro/v1/transcripts/jobs/${event_id}`,
          { credentials: 'include' }
        )
        const data = await res.json()
        if (data.ok !== false) {
          setDetail(data)
        } else {
          setError(data.message ?? 'Failed to load result.')
        }
      } catch {
        setError('Network error. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    fetchDetail()
  }, [event_id])

  // Poll if processing
  useEffect(() => {
    if (!detail || detail.status !== 'processing') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `https://api.virtuallaunch.pro/v1/transcripts/jobs/${event_id}`,
          { credentials: 'include' }
        )
        const data = await res.json()
        if (data.ok !== false) setDetail(data)
      } catch {/* retry on next poll */}
    }, 10_000)
    return () => clearInterval(interval)
  }, [detail, event_id])

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-800" />
        <div className="h-64 animate-pulse rounded-2xl bg-slate-900/60" />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-red-800/40 bg-red-900/20 p-6 text-center">
          <p className="text-sm text-red-400">{error ?? 'Result not found.'}</p>
          <Link
            href="/transcripts/results"
            className="mt-4 inline-block text-sm text-orange-400 underline"
          >
            Back to results
          </Link>
        </div>
      </div>
    )
  }

  const result = detail.result

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/transcripts/results" className="text-xs text-slate-500 hover:text-orange-400 transition">
            &larr; All Results
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            {TYPE_LABELS[detail.transcriptType] ?? detail.transcriptType}
          </h1>
          {detail.taxYear && (
            <p className="text-sm text-slate-400">Tax Year {detail.taxYear}</p>
          )}
        </div>
        <StatusBadge status={detail.status} />
      </div>

      {/* Meta */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MetaCard label="Job ID" value={detail.jobId.slice(0, 16) + '...'} />
        <MetaCard label="Submitted" value={new Date(detail.createdAt).toLocaleString()} />
        <MetaCard label="Tokens Used" value={`${detail.tokensDebited} transcript`} />
      </div>

      {/* Result Details */}
      {detail.status === 'processing' && (
        <div className="rounded-2xl border border-amber-800/40 bg-amber-900/20 p-6 text-center">
          <p className="text-sm text-amber-300">Processing... This page will refresh automatically.</p>
        </div>
      )}

      {detail.status === 'failed' && (
        <div className="rounded-2xl border border-red-800/40 bg-red-900/20 p-6 text-center">
          <p className="text-sm text-red-400">This job failed to process.</p>
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6 space-y-6">
          <h2 className="text-base font-bold text-white">Parsed Results</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <MetaCard label="Lines" value={result.lineCount.toLocaleString()} />
            <MetaCard label="Characters" value={result.charCount.toLocaleString()} />
          </div>

          <FieldGroup label="TINs Found" items={result.extractedFields.tins} />
          <FieldGroup label="Dates Found" items={result.extractedFields.dates} />
          <FieldGroup label="Amounts Found" items={result.extractedFields.amounts} />
          {result.extractedFields.cycles.length > 0 && (
            <FieldGroup label="Cycle Codes" items={result.extractedFields.cycles} />
          )}

          {result.extractedFields.accountBalance && (
            <div className="rounded-xl border border-slate-800/40 bg-slate-950/40 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Account Balance
              </span>
              <p className="mt-1 text-white font-mono">
                ${result.extractedFields.accountBalance}
              </p>
            </div>
          )}

          {result.extractedFields.withheld && (
            <div className="rounded-xl border border-slate-800/40 bg-slate-950/40 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Withheld
              </span>
              <p className="mt-1 text-white font-mono">
                ${result.extractedFields.withheld}
              </p>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Parsed {new Date(result.parsedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-emerald-900/60 text-emerald-300',
    processing: 'bg-amber-900/60 text-amber-300',
    pending: 'bg-slate-700/60 text-slate-300',
    failed: 'bg-red-900/60 text-red-300',
  }
  const labels: Record<string, string> = {
    completed: 'Completed',
    processing: 'Processing',
    pending: 'Pending',
    failed: 'Failed',
  }
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles[status] ?? styles.pending}`}>
      {labels[status] ?? status}
    </span>
  )
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800/40 bg-slate-950/40 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <p className="mt-1 text-sm text-white">{value}</p>
    </div>
  )
}

function FieldGroup({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-slate-800/40 bg-slate-950/40 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">None detected</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((item, i) => (
            <span key={i} className="rounded-lg bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-300">
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
