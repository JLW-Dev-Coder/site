'use client'

import { useState } from 'react'

interface TaxMatter {
  taxType: string
  formNumber: string
  yearOrPeriod: string
}

interface FormData {
  form: string
  taxpayer: Record<string, string>
  appointee: Record<string, string>
  taxMatters: TaxMatter[]
  specificUseNotRecorded: boolean
  generatedAt: string
}

const FIELD_LABEL: Record<string, string> = {
  taxpayerName: 'Taxpayer Name',
  taxpayerTin: 'Taxpayer TIN (SSN or EIN)',
  taxpayerAddress: 'Taxpayer Address',
  taxpayerPhone: 'Taxpayer Phone',
  appointeeName: 'Appointee Name',
  appointeeCafNumber: 'CAF Number',
  appointeeAddress: 'Appointee Address',
  appointeePhone: 'Appointee Phone',
}

const EMPTY_MATTER: TaxMatter = { taxType: '', formNumber: '', yearOrPeriod: '' }

export default function Form8821Page() {
  const [fields, setFields] = useState({
    taxpayerName: '', taxpayerTin: '', taxpayerAddress: '', taxpayerPhone: '',
    appointeeName: '', appointeeCafNumber: '', appointeeAddress: '', appointeePhone: '',
  })
  const [taxMatters, setTaxMatters] = useState<TaxMatter[]>([{ ...EMPTY_MATTER }])
  const [specificUseNotRecorded, setSpecificUseNotRecorded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FormData | null>(null)

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  function setMatter(i: number, key: keyof TaxMatter, value: string) {
    setTaxMatters((prev) => prev.map((m, idx) => idx === i ? { ...m, [key]: value } : m))
  }

  function addMatter() {
    setTaxMatters((prev) => [...prev, { ...EMPTY_MATTER }])
  }

  function removeMatter(i: number) {
    setTaxMatters((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setSubmitting(true)
    try {
      const res = await fetch('https://api.virtuallaunch.pro/v1/tools/form-8821', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          ...fields,
          taxMatters,
          specificUseNotRecorded,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? 'Submission failed.')
        return
      }
      setResult(data.formData as FormData)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const textClass = 'w-full rounded-xl border border-slate-800/60 bg-slate-900/60 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none'
  const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400'

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Form 8821 — Tax Information Authorization</h1>
        <p className="mt-1 text-sm text-slate-400">
          Autofill IRS Form 8821. Costs <span className="text-amber-400 font-semibold">1 tax game token</span> per submission.
        </p>
      </div>

      {result ? (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white">Form 8821 Generated</h2>
            <span className="rounded-full bg-emerald-900/60 px-3 py-1 text-xs font-semibold text-emerald-300">Completed</span>
          </div>

          <div className="space-y-4 text-sm">
            <Section title="Taxpayer">
              <Row label="Name" value={result.taxpayer?.name} />
              <Row label="TIN" value={result.taxpayer?.tin} />
              <Row label="Address" value={result.taxpayer?.address} />
            </Section>
            <Section title="Appointee">
              <Row label="Name" value={result.appointee?.name} />
              <Row label="CAF Number" value={result.appointee?.cafNumber} />
              <Row label="Address" value={result.appointee?.address} />
            </Section>
            {result.specificUseNotRecorded && (
              <p className="text-xs text-amber-400">Specific use not recorded on CAF</p>
            )}
            <Section title="Tax Matters">
              {(result.taxMatters ?? []).map((m, i) => (
                <div key={i} className="rounded-xl border border-slate-800/40 bg-slate-900 px-4 py-3 space-y-1">
                  <Row label="Tax Type" value={m.taxType} />
                  <Row label="Form No." value={m.formNumber} />
                  <Row label="Year / Period" value={m.yearOrPeriod} />
                </div>
              ))}
            </Section>
            <p className="text-xs text-slate-500">
              Generated {new Date(result.generatedAt).toLocaleString()}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setResult(null)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/60 py-2.5 text-sm font-semibold text-slate-300 hover:text-white transition"
          >
            Submit Another
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <fieldset className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5 space-y-4">
            <legend className="px-1 text-xs font-bold uppercase tracking-widest text-slate-400">Taxpayer</legend>
            {(['taxpayerName', 'taxpayerTin', 'taxpayerAddress', 'taxpayerPhone'] as const).map((key) => (
              <div key={key}>
                <label className={labelClass}>{FIELD_LABEL[key]}</label>
                <input
                  type="text"
                  value={fields[key]}
                  onChange={(e) => setField(key, e.target.value)}
                  required={key !== 'taxpayerPhone'}
                  className={textClass}
                />
              </div>
            ))}
          </fieldset>

          <fieldset className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5 space-y-4">
            <legend className="px-1 text-xs font-bold uppercase tracking-widest text-slate-400">Appointee</legend>
            {(['appointeeName', 'appointeeCafNumber', 'appointeeAddress', 'appointeePhone'] as const).map((key) => (
              <div key={key}>
                <label className={labelClass}>{FIELD_LABEL[key]}</label>
                <input
                  type="text"
                  value={fields[key]}
                  onChange={(e) => setField(key, e.target.value)}
                  required={key === 'appointeeName' || key === 'appointeeAddress'}
                  className={textClass}
                />
              </div>
            ))}
            <div className="flex items-center gap-3 pt-1">
              <input
                id="specificUse"
                type="checkbox"
                checked={specificUseNotRecorded}
                onChange={(e) => setSpecificUseNotRecorded(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-orange-500 focus:ring-orange-500/30"
              />
              <label htmlFor="specificUse" className="text-sm text-slate-300">
                Specific use not to be recorded on CAF
              </label>
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5 space-y-4">
            <legend className="px-1 text-xs font-bold uppercase tracking-widest text-slate-400">Tax Matters</legend>
            {taxMatters.map((m, i) => (
              <div key={i} className="rounded-xl border border-slate-800/40 bg-slate-950/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Matter {i + 1}</span>
                  {taxMatters.length > 1 && (
                    <button type="button" onClick={() => removeMatter(i)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                  )}
                </div>
                {(['taxType', 'formNumber', 'yearOrPeriod'] as const).map((key) => (
                  <div key={key}>
                    <label className={labelClass}>{key === 'taxType' ? 'Tax Type' : key === 'formNumber' ? 'Form Number' : 'Year / Period'}</label>
                    <input
                      type="text"
                      value={m[key]}
                      onChange={(e) => setMatter(i, key, e.target.value)}
                      required
                      placeholder={key === 'taxType' ? 'e.g. Income' : key === 'formNumber' ? 'e.g. 1040' : 'e.g. 2023'}
                      className={textClass}
                    />
                  </div>
                ))}
              </div>
            ))}
            <button
              type="button"
              onClick={addMatter}
              className="text-xs font-semibold text-orange-400 hover:text-orange-300 transition"
            >
              + Add Tax Matter
            </button>
          </fieldset>

          {error && <p className="rounded-xl bg-red-900/30 px-4 py-3 text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-3 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition disabled:opacity-60"
          >
            {submitting ? 'Generating…' : 'Generate Form 8821 — 1 Token'}
          </button>
        </form>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2 text-sm">
      <span className="shrink-0 w-28 text-slate-500">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  )
}
