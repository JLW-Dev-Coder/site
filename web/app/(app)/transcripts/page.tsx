'use client'

import { useState } from 'react'

type TranscriptType = 'account' | 'record_of_account' | 'return' | 'wage_and_income'

interface ExtractedFields {
  tins: string[]
  dates: string[]
  amounts: string[]
  cycles: string[]
  accountBalance: string | null
  withheld: string | null
}

interface TranscriptResult {
  jobId: string
  transcriptType: TranscriptType
  taxYear: number | null
  parsedAt: string
  extractedFields: ExtractedFields
  lineCount: number
  charCount: number
}

const TYPE_LABELS: Record<TranscriptType, string> = {
  account: 'Account Transcript',
  record_of_account: 'Record of Account',
  return: 'Return Transcript',
  wage_and_income: 'Wage & Income Transcript',
}

export default function TranscriptsPage() {
  const [transcriptText, setTranscriptText] = useState('')
  const [transcriptType, setTranscriptType] = useState<TranscriptType>('account')
  const [taxYear, setTaxYear] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TranscriptResult | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        eventId: crypto.randomUUID(),
        transcriptText,
        transcriptType,
      }
      if (taxYear) body.taxYear = parseInt(taxYear, 10)

      const res = await fetch('https://api.virtuallaunch.pro/v1/transcripts/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? 'Submission failed.')
        return
      }
      setResult(data.result as TranscriptResult)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Transcript Parser</h1>
        <p className="mt-1 text-sm text-slate-400">
          Paste an IRS transcript to extract structured data. Costs{' '}
          <span className="text-amber-400 font-semibold">1 transcript token</span> per parse.
        </p>
      </div>

      {result ? (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white">Parse Result</h2>
            <span className="rounded-full bg-emerald-900/60 px-3 py-1 text-xs font-semibold text-emerald-300">Completed</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <Stat label="Transcript Type" value={TYPE_LABELS[result.transcriptType]} />
            {result.taxYear && <Stat label="Tax Year" value={String(result.taxYear)} />}
            <Stat label="Lines" value={result.lineCount.toLocaleString()} />
            <Stat label="Characters" value={result.charCount.toLocaleString()} />
          </div>

          <div className="space-y-4">
            <FieldGroup label="TINs Found" items={result.extractedFields.tins} empty="None detected" />
            <FieldGroup label="Dates Found" items={result.extractedFields.dates} empty="None detected" />
            <FieldGroup label="Amounts Found" items={result.extractedFields.amounts} empty="None detected" />
            {result.extractedFields.cycles.length > 0 && (
              <FieldGroup label="Cycle Codes" items={result.extractedFields.cycles} empty="None detected" />
            )}
            {result.extractedFields.accountBalance && (
              <div className="rounded-xl border border-slate-800/40 bg-slate-950/40 px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Account Balance</span>
                <p className="mt-1 text-white font-mono">${result.extractedFields.accountBalance}</p>
              </div>
            )}
            {result.extractedFields.withheld && (
              <div className="rounded-xl border border-slate-800/40 bg-slate-950/40 px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Withheld</span>
                <p className="mt-1 text-white font-mono">${result.extractedFields.withheld}</p>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Parsed {new Date(result.parsedAt).toLocaleString()} · Job ID: {result.jobId}
          </p>

          <button
            type="button"
            onClick={() => { setResult(null); setTranscriptText('') }}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/60 py-2.5 text-sm font-semibold text-slate-300 hover:text-white transition"
          >
            Parse Another
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5 space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Transcript Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TYPE_LABELS) as TranscriptType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTranscriptType(t)}
                    className={`rounded-xl py-2 px-3 text-xs font-semibold text-left transition ${
                      transcriptType === t
                        ? 'bg-orange-500 text-slate-950'
                        : 'border border-slate-700 bg-slate-800/60 text-slate-300 hover:border-orange-500/40'
                    }`}
                  >
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Tax Year (optional)
              </label>
              <input
                type="number"
                min={1990}
                max={2100}
                value={taxYear}
                onChange={(e) => setTaxYear(e.target.value)}
                placeholder="e.g. 2023"
                className="w-full rounded-xl border border-slate-800/60 bg-slate-900/60 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Transcript Text
              </label>
              <textarea
                rows={14}
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                placeholder="Paste your IRS transcript here…"
                required
                className="w-full rounded-xl border border-slate-800/60 bg-slate-950/60 px-4 py-3 text-sm font-mono text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none resize-y"
              />
              <p className="mt-1 text-xs text-slate-600">{transcriptText.length.toLocaleString()} characters</p>
            </div>
          </div>

          {error && <p className="rounded-xl bg-red-900/30 px-4 py-3 text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !transcriptText.trim()}
            className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-3 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition disabled:opacity-60"
          >
            {submitting ? 'Parsing…' : 'Parse Transcript — 1 Token'}
          </button>
        </form>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800/40 bg-slate-950/40 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <p className="mt-1 text-sm text-white">{value}</p>
    </div>
  )
}

function FieldGroup({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-xl border border-slate-800/40 bg-slate-950/40 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">{empty}</p>
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
