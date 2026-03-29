'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type TranscriptType = 'account' | 'return' | 'wage_income' | 'record'

const TYPE_LABELS: Record<TranscriptType, string> = {
  account: 'Account Transcript',
  return: 'Return Transcript',
  wage_income: 'Wage & Income Transcript',
  record: 'Record of Account',
}

interface TokenBalanceData {
  transcriptTokens: number
}

export default function TranscriptSubmitPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [transcriptType, setTranscriptType] = useState<TranscriptType>('account')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<TokenBalanceData | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null)

  // Fetch token balance on mount
  useEffect(() => {
    async function fetchBalance() {
      try {
        const res = await fetch('https://api.virtuallaunch.pro/v1/auth/session', {
          credentials: 'include',
        })
        const sessionData = await res.json()
        if (!sessionData.ok) {
          setBalance({ transcriptTokens: 0 })
          return
        }

        const balRes = await fetch(
          `https://api.virtuallaunch.pro/v1/tokens/balance/${sessionData.session.account_id}`,
          { credentials: 'include' }
        )
        const balData = await balRes.json()
        if (balData.ok) {
          setBalance({ transcriptTokens: balData.balance.transcriptTokens })
        } else {
          setBalance({ transcriptTokens: 0 })
        }
      } catch {
        setBalance({ transcriptTokens: 0 })
      } finally {
        setBalanceLoading(false)
      }
    }
    fetchBalance()
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null)
    setPreviewData(null)
    const selected = e.target.files?.[0]
    if (!selected) {
      setFile(null)
      return
    }

    if (!selected.name.endsWith('.json')) {
      setFileError('Only .json files are accepted.')
      setFile(null)
      return
    }

    if (selected.size > 1_048_576) {
      setFileError('File size must be under 1 MB.')
      setFile(null)
      return
    }

    setFile(selected)

    // Parse and preview
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string)
        setPreviewData(parsed)

        // Auto-detect transcript type if present
        if (parsed.transcript_type && Object.keys(TYPE_LABELS).includes(parsed.transcript_type)) {
          setTranscriptType(parsed.transcript_type as TranscriptType)
        }
      } catch {
        setFileError('Invalid JSON file.')
        setFile(null)
      }
    }
    reader.readAsText(selected)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !previewData) return

    setError(null)
    setSubmitting(true)

    try {
      // Build payload matching contract schema
      const payload = {
        account_id: '', // Will be filled by session on server
        transcript_data: {
          transcript_type: transcriptType,
          transactions: previewData.transactions ?? [],
          ...previewData,
          transcript_type: transcriptType,
        },
      }

      const res = await fetch('https://api.virtuallaunch.pro/v1/tools/transcript-parser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? 'Submission failed.')
        return
      }

      // Redirect to results page for this event
      router.push(`/transcripts/results/${data.event_id}`)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const insufficientTokens = balance !== null && balance.transcriptTokens < 1

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Submit Transcript</h1>
        <p className="mt-1 text-sm text-slate-400">
          Upload a JSON transcript file for parsing. Costs{' '}
          <span className="text-amber-400 font-semibold">1 transcript token</span> per submission.
        </p>
      </div>

      {/* Token Balance Card */}
      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Transcript Token Balance
            </span>
            {balanceLoading ? (
              <p className="mt-1 text-lg font-bold text-slate-400">Loading...</p>
            ) : (
              <p className={`mt-1 text-lg font-bold ${insufficientTokens ? 'text-red-400' : 'text-white'}`}>
                {balance?.transcriptTokens.toLocaleString() ?? 0} tokens
              </p>
            )}
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5">
            <span className="text-xs font-semibold text-amber-400">Cost: 1 token</span>
          </div>
        </div>
        {insufficientTokens && (
          <p className="mt-2 text-sm text-red-400">
            Insufficient tokens. Purchase more tokens to continue.
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* File Upload */}
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5 space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Transcript File (.json)
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/40 px-6 py-8 text-center transition hover:border-orange-500/40"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
              {file ? (
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">{file.name}</p>
                  <p className="text-xs text-slate-500">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm text-slate-400">Click to select a .json file</p>
                  <p className="text-xs text-slate-600">Max 1 MB</p>
                </div>
              )}
            </div>
            {fileError && (
              <p className="mt-2 text-sm text-red-400">{fileError}</p>
            )}
          </div>

          {/* Transcript Type Selector */}
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
        </div>

        {/* JSON Preview */}
        {previewData && (
          <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              File Preview
            </span>
            <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-slate-950/60 p-3 text-xs font-mono text-slate-300">
              {JSON.stringify(previewData, null, 2).slice(0, 2000)}
            </pre>
            {previewData.transactions && Array.isArray(previewData.transactions) && (
              <p className="mt-2 text-xs text-slate-500">
                {previewData.transactions.length} transaction(s) found
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-red-900/30 px-4 py-3 text-sm text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting || !file || !previewData || insufficientTokens}
          className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-3 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition disabled:opacity-60"
        >
          {submitting ? 'Submitting...' : 'Parse Transcript — 1 Token'}
        </button>
      </form>
    </div>
  )
}
