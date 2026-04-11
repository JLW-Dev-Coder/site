'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ArrowLeft,
  Download,
  FileText,
  Mail,
  Plus,
  Shield,
  Trash2,
  User,
  UserCheck,
  Eye,
  EyeOff,
  CheckCircle2,
} from 'lucide-react'

import {
  Checkbox,
  Field,
  Grid2,
  Label,
  Select,
  TextArea,
  TextInput,
} from '../compliance/components/FormPrimitives'

/* ── contract shape (flat) ─────────────────────────────────────────── */

type RepDesignation =
  | 'Attorney'
  | 'CPA'
  | 'Enrolled Agent'
  | 'Officer'
  | 'Full-Time Employee'
  | 'Family Member'
  | 'Enrolled Actuary'
  | 'Enrolled Retirement Plan Agent'
  | 'Registered Tax Return Preparer'
  | 'Student Attorney'
  | 'Other'

const REP_DESIGNATIONS: RepDesignation[] = [
  'Attorney',
  'CPA',
  'Enrolled Agent',
  'Officer',
  'Full-Time Employee',
  'Family Member',
  'Enrolled Actuary',
  'Enrolled Retirement Plan Agent',
  'Registered Tax Return Preparer',
  'Student Attorney',
  'Other',
]

interface TaxMatter {
  description: string
  tax_form: string
  years_or_periods: string
}

interface ClientPrefill {
  name: string
  tin: string
  address: string
  daytime_phone: string
}

interface RepPrefill {
  name: string
  caf_number: string
  ptin: string
  phone: string
  fax: string
  address: string
  designation: RepDesignation
  jurisdiction: string
}

/* ── placeholder pre-fill ──────────────────────────────────────────── *
 * Client data comes from the case record on the Client Pool row.
 * Rep data comes from the logged-in pro's own profile.
 * Both are shaped to match the contract payload directly so the
 * Phase D wire-up swaps in real API data without restructuring.
 */

const CLIENT_PREFILL: ClientPrefill = {
  name: 'Maria Rivera',
  tin: '123-45-6789',
  address: '742 Evergreen Terrace, Springfield, CA 92020',
  daytime_phone: '(555) 867-5309',
}

const REP_PREFILL: RepPrefill = {
  name: 'Jamie Williams, EA',
  caf_number: '1234-56789R',
  ptin: 'P01234567',
  phone: '(619) 555-0142',
  fax: '',
  address: '1175 Avocado Ave, Suite 101 PMB 1010, El Cajon, CA 92020',
  designation: 'Enrolled Agent',
  jurisdiction: 'CA',
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

/* ── helpers ────────────────────────────────────────────────────────── */

function base64ToBlob(base64: string, mime = 'application/pdf'): Blob {
  const chars = atob(base64)
  const bytes = new Uint8Array(chars.length)
  for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function tinLast4(tin: string): string {
  const digits = tin.replace(/\D/g, '')
  return digits.slice(-4) || '****'
}

interface GenerateResponse {
  ok: boolean
  pdf_base64: string
  filename: string
  event_id?: string
  build_id?: string
}

/* ── page ──────────────────────────────────────────────────────────── */

export default function Staff2848Page() {
  const params = useParams<{ clientId: string }>()
  const clientId = params?.clientId ?? 'c1'

  // Section 1 — Taxpayer (pre-filled from case record)
  const [taxpayerName, setTaxpayerName] = useState(CLIENT_PREFILL.name)
  const [taxpayerTin, setTaxpayerTin] = useState(CLIENT_PREFILL.tin)
  const [taxpayerAddress, setTaxpayerAddress] = useState(CLIENT_PREFILL.address)
  const [taxpayerPhone, setTaxpayerPhone] = useState(CLIENT_PREFILL.daytime_phone)
  const [tinVisible, setTinVisible] = useState(false)

  // Section 2 — Representative (pre-filled from pro's profile)
  const [repName, setRepName] = useState(REP_PREFILL.name)
  const [repCaf, setRepCaf] = useState(REP_PREFILL.caf_number)
  const [repPtin, setRepPtin] = useState(REP_PREFILL.ptin)
  const [repPhone, setRepPhone] = useState(REP_PREFILL.phone)
  const [repFax, setRepFax] = useState(REP_PREFILL.fax)
  const [repAddress, setRepAddress] = useState(REP_PREFILL.address)
  const [repDesignation, setRepDesignation] = useState<RepDesignation>(
    REP_PREFILL.designation
  )
  const [repJurisdiction, setRepJurisdiction] = useState(REP_PREFILL.jurisdiction)

  // Section 3 — Tax matters
  const [matters, setMatters] = useState<TaxMatter[]>([
    { description: 'Income', tax_form: '1040', years_or_periods: '2021, 2022, 2023' },
  ])

  // Section 4 — Line 5a acts
  const [accessRecords, setAccessRecords] = useState(true)
  const [signDisclosure, setSignDisclosure] = useState(true)
  const [substituteReturn, setSubstituteReturn] = useState(false)
  const [signClaimRefund, setSignClaimRefund] = useState(false)
  const [receiveRefund, setReceiveRefund] = useState(false)
  const [otherAuth, setOtherAuth] = useState(false)
  const [otherAuthText, setOtherAuthText] = useState('')

  // Submit state
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResponse | null>(null)

  const canAddMatter = matters.length < 4

  function updateMatter(index: number, patch: Partial<TaxMatter>) {
    setMatters((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)))
  }

  function addMatter() {
    if (!canAddMatter) return
    setMatters((prev) => [...prev, { description: '', tax_form: '', years_or_periods: '' }])
  }

  function removeMatter(index: number) {
    if (matters.length <= 1) return
    setMatters((prev) => prev.filter((_, i) => i !== index))
  }

  function validate(): string | null {
    if (!taxpayerName.trim()) return 'Client name is required.'
    const tinDigits = taxpayerTin.replace(/\D/g, '')
    if (tinDigits.length !== 9) return 'Client TIN must be 9 digits.'
    if (!taxpayerAddress.trim()) return 'Client mailing address is required.'
    if (!repName.trim()) return 'Representative name is required.'
    if (!repCaf.trim()) return 'Representative CAF number is required.'
    if (!repPtin.trim()) return 'Representative PTIN is required.'
    if (!repPhone.trim()) return 'Representative phone is required.'
    if (!repAddress.trim()) return 'Representative address is required.'
    if (!repDesignation) return 'Representative designation is required.'
    const filled = matters.filter(
      (m) => m.description.trim() || m.tax_form.trim() || m.years_or_periods.trim()
    )
    if (filled.length === 0) return 'Add at least one tax matter.'
    for (const m of filled) {
      if (!m.description.trim() || !m.tax_form.trim() || !m.years_or_periods.trim()) {
        return 'Each tax matter needs a description, form number, and years/periods.'
      }
    }
    return null
  }

  function buildPayload() {
    const tinDigits = taxpayerTin.replace(/\D/g, '')
    const formattedTin =
      tinDigits.length === 9 ? `${tinDigits.slice(0, 3)}-${tinDigits.slice(3, 5)}-${tinDigits.slice(5)}` : taxpayerTin
    return {
      taxpayer_name: taxpayerName.trim(),
      taxpayer_address: taxpayerAddress.trim(),
      taxpayer_tin: formattedTin,
      taxpayer_daytime_phone: taxpayerPhone.trim() || undefined,
      rep_name: repName.trim(),
      rep_caf_number: repCaf.trim(),
      rep_ptin: repPtin.trim(),
      rep_phone: repPhone.trim(),
      rep_fax: repFax.trim() || null,
      rep_address: repAddress.trim(),
      rep_designation: repDesignation,
      rep_jurisdiction: repJurisdiction.trim() || null,
      tax_matters: matters
        .filter((m) => m.description.trim())
        .map((m) => ({
          description: m.description.trim(),
          tax_form: m.tax_form.trim(),
          years_or_periods: m.years_or_periods.trim(),
        })),
      line5a_access_irs_records: accessRecords,
      line5a_sign_consent_disclosure: signDisclosure,
      line5a_substitute_return: substituteReturn,
      line5a_sign_claim_refund: signClaimRefund,
      line5a_receive_refund: receiveRefund,
      line5a_other: otherAuth,
      line5a_other_text: otherAuth ? otherAuthText.trim() || null : null,
      case_id: clientId,
      generated_by: 'staff' as const,
    }
  }

  async function handleGenerate() {
    setError(null)
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/v1/tools/2848/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      })
      const body = (await res.json().catch(() => ({}))) as Partial<GenerateResponse> & {
        error?: string
      }
      if (!res.ok || !body.ok || !body.pdf_base64) {
        throw new Error(body.error || `Generate failed (${res.status})`)
      }
      setResult({
        ok: true,
        pdf_base64: body.pdf_base64,
        filename: body.filename || 'Form_2848.pdf',
        event_id: body.event_id,
        build_id: body.build_id,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate Form 2848.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleDownload() {
    if (!result) return
    const blob = base64ToBlob(result.pdf_base64)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename || 'form-2848.pdf'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function handleSendToClient() {
    // Placeholder — Phase D will trigger an email to the client with
    // a link to the TMP eSign page for this case.
    // eslint-disable-next-line no-console
    console.log('[2848] send to client', { clientId, filename: result?.filename })
    alert('Send to Client — not yet implemented. Will email the client a link to the TMP eSign page.')
  }

  function handleMarkStepComplete() {
    // Placeholder — Phase D will PATCH the case step status back to "complete".
    // eslint-disable-next-line no-console
    console.log('[2848] mark step complete', { clientId })
    window.location.href = `/client-pool/${clientId}`
  }

  const tinDisplay = useMemo(() => {
    if (tinVisible) return taxpayerTin
    const last4 = tinLast4(taxpayerTin)
    return `•••-••-${last4}`
  }, [taxpayerTin, tinVisible])

  /* ── render ─────────────────────────────────────────────────────── */

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      {/* Header */}
      <div className="space-y-2">
        <Link
          href={`/client-pool/${clientId}`}
          className="inline-flex items-center gap-1.5 text-sm text-white/60 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Client Record
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">Generate Form 2848</h1>
            <p className="mt-1 text-sm text-white/60">
              Power of Attorney for{' '}
              <span className="font-medium text-white/80">{CLIENT_PREFILL.name}</span>
            </p>
            <p className="mt-1 text-xs text-white/40">
              Phase 2 · Processing / Due Diligence → Authorization + CAF
            </p>
          </div>
          <div className="hidden rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-1.5 text-xs font-medium text-brand-orange sm:block">
            Staff generation
          </div>
        </div>
      </div>

      {/* Success state */}
      {result ? (
        <div className="space-y-4 rounded-xl border border-green-500/30 bg-green-500/5 p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-green-400" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-white">Form 2848 generated</h2>
              <p className="mt-1 text-sm text-white/70">
                Filename: <span className="font-mono text-white/90">{result.filename}</span>
              </p>
              {result.event_id ? (
                <p className="mt-1 font-mono text-xs text-white/40">event_id: {result.event_id}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={handleSendToClient}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              <Mail className="h-4 w-4" />
              Send to Client for Signature
            </button>
            <button
              type="button"
              onClick={handleMarkStepComplete}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Step Complete
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="ml-auto text-sm text-white/50 transition hover:text-white/80"
            >
              Edit &amp; regenerate
            </button>
          </div>
        </div>
      ) : null}

      {/* Form */}
      <fieldset disabled={submitting || !!result} className="space-y-6">
        {/* Section 1 — Client */}
        <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <header className="flex items-center gap-2">
            <User className="h-5 w-5 text-brand-orange" />
            <h2 className="text-base font-semibold text-white">
              1. Client Information (Taxpayer)
            </h2>
          </header>
          <p className="text-xs text-white/50">
            Pre-filled from the case record. Edit if the data needs correction before filing.
          </p>
          <Grid2>
            <Field label="Full Legal Name" span={2}>
              <TextInput
                value={taxpayerName}
                onChange={(e) => setTaxpayerName(e.target.value)}
                placeholder="Maria Rivera"
              />
            </Field>
            <div>
              <Label>SSN / EIN</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  {tinVisible ? (
                    <TextInput
                      value={taxpayerTin}
                      onChange={(e) => setTaxpayerTin(e.target.value)}
                      placeholder="123-45-6789"
                      mono
                    />
                  ) : (
                    <div className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white">
                      {tinDisplay}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setTinVisible((v) => !v)}
                  aria-pressed={tinVisible}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
                >
                  {tinVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {tinVisible ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <Field label="Daytime Phone">
              <TextInput
                value={taxpayerPhone}
                onChange={(e) => setTaxpayerPhone(e.target.value)}
                placeholder="(555) 867-5309"
              />
            </Field>
            <Field label="Mailing Address" span={2}>
              <TextArea
                value={taxpayerAddress}
                onChange={(e) => setTaxpayerAddress(e.target.value)}
                rows={2}
                placeholder="742 Evergreen Terrace, Springfield, CA 92020"
              />
            </Field>
          </Grid2>
        </section>

        {/* Section 2 — Representative */}
        <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <header className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-brand-orange" />
            <h2 className="text-base font-semibold text-white">
              2. Your Information (Representative)
            </h2>
          </header>
          <p className="text-xs text-white/50">
            Pre-filled from your profile. This is the tax professional signing the POA as the
            authorized representative.
          </p>
          <Grid2>
            <Field label="Your Name">
              <TextInput value={repName} onChange={(e) => setRepName(e.target.value)} />
            </Field>
            <Field label="Designation">
              <Select
                options={REP_DESIGNATIONS}
                value={repDesignation}
                onChange={(e) => setRepDesignation(e.target.value as RepDesignation)}
                placeholder="Select designation..."
              />
            </Field>
            <Field label="CAF Number">
              <TextInput
                value={repCaf}
                onChange={(e) => setRepCaf(e.target.value)}
                placeholder="1234-56789R"
                mono
              />
            </Field>
            <Field label="PTIN">
              <TextInput
                value={repPtin}
                onChange={(e) => setRepPtin(e.target.value)}
                placeholder="P01234567"
                mono
              />
            </Field>
            <Field label="Phone">
              <TextInput
                value={repPhone}
                onChange={(e) => setRepPhone(e.target.value)}
                placeholder="(619) 555-0142"
              />
            </Field>
            <Field label="Fax (optional)">
              <TextInput
                value={repFax}
                onChange={(e) => setRepFax(e.target.value)}
                placeholder="(619) 555-0143"
              />
            </Field>
            <Field label="Jurisdiction (state / licensing authority)">
              <TextInput
                value={repJurisdiction}
                onChange={(e) => setRepJurisdiction(e.target.value)}
                placeholder="CA"
              />
            </Field>
            <Field label="Address" span={2}>
              <TextArea
                value={repAddress}
                onChange={(e) => setRepAddress(e.target.value)}
                rows={2}
              />
            </Field>
          </Grid2>
        </section>

        {/* Section 3 — Tax Matters */}
        <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <header className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand-orange" />
              <h2 className="text-base font-semibold text-white">3. Tax Matters (Line 3)</h2>
            </div>
            <span className="text-xs text-white/40">
              {matters.length} of 4
            </span>
          </header>
          <p className="text-xs text-white/50">
            Describe each matter you are authorized to handle. Use IRS form numbers (1040, 941,
            1120, etc.) and year or period ranges.
          </p>

          <div className="space-y-3">
            {matters.map((m, i) => (
              <div
                key={i}
                className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-white/50">
                    Matter {i + 1}
                  </span>
                  {matters.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeMatter(i)}
                      className="inline-flex items-center gap-1 text-xs text-white/40 transition hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  ) : null}
                </div>
                <Field label="Description of Matter">
                  <TextInput
                    value={m.description}
                    onChange={(e) => updateMatter(i, { description: e.target.value })}
                    placeholder="Income, Employment, Excise, Estate, Gift, Civil Penalty, etc."
                  />
                </Field>
                <Grid2>
                  <Field label="Tax Form Number">
                    <TextInput
                      value={m.tax_form}
                      onChange={(e) => updateMatter(i, { tax_form: e.target.value })}
                      placeholder="1040"
                    />
                  </Field>
                  <Field label="Years or Periods">
                    <TextInput
                      value={m.years_or_periods}
                      onChange={(e) => updateMatter(i, { years_or_periods: e.target.value })}
                      placeholder="2021, 2022, 2023"
                    />
                  </Field>
                </Grid2>
              </div>
            ))}
          </div>

          {canAddMatter ? (
            <button
              type="button"
              onClick={addMatter}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-white/15 bg-transparent px-3 py-2 text-sm font-medium text-white/70 transition hover:border-brand-orange/40 hover:text-white"
            >
              <Plus className="h-4 w-4" />
              Add another matter
            </button>
          ) : null}
        </section>

        {/* Section 4 — Line 5a acts */}
        <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <header className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-brand-orange" />
            <h2 className="text-base font-semibold text-white">
              4. Authorized Acts (Line 5a)
            </h2>
          </header>
          <p className="text-xs text-white/50">
            Specific acts the representative is authorized to perform on behalf of the taxpayer.
            The first two are checked by default and should rarely be cleared.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox
              checked={accessRecords}
              onChange={setAccessRecords}
              label="Access confidential IRS records"
              sub="Inspect and receive confidential tax information (required for almost every representation)."
            />
            <Checkbox
              checked={signDisclosure}
              onChange={setSignDisclosure}
              label="Sign a consent to disclose tax information"
              sub="Authorize disclosure of tax return info to third parties as needed during representation."
            />
            <Checkbox
              checked={substituteReturn}
              onChange={setSubstituteReturn}
              label="Substitute or add another representative"
              sub="Allows this rep to delegate or substitute another authorized representative."
            />
            <Checkbox
              checked={signClaimRefund}
              onChange={setSignClaimRefund}
              label="Sign a return / claim for refund"
              sub="Only granted in limited circumstances (illness, absence, disability — see §1.6012-1(a)(5))."
            />
            <Checkbox
              checked={receiveRefund}
              onChange={setReceiveRefund}
              label="Receive refund checks"
              sub="Rep may receive — but not endorse or cash — refund checks on behalf of taxpayer."
            />
            <Checkbox
              checked={otherAuth}
              onChange={setOtherAuth}
              label="Other specific authorization"
              sub="List any other act not covered above — specify below."
            />
          </div>
          {otherAuth ? (
            <Field label="Other authorization — describe">
              <TextArea
                value={otherAuthText}
                onChange={(e) => setOtherAuthText(e.target.value)}
                rows={2}
                placeholder="Describe the additional specific act authorized by the taxpayer..."
              />
            </Field>
          ) : null}
        </section>

        {/* Section 5 — Review & Generate */}
        <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <header className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-brand-orange" />
            <h2 className="text-base font-semibold text-white">5. Review &amp; Generate</h2>
          </header>
          <p className="text-xs text-white/50">
            No electronic signature is captured here — this form is generated for IRS filing or
            to send to the client for wet/electronic signing.
          </p>

          <div className="grid gap-4 rounded-lg border border-white/10 bg-black/20 p-4 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-white/40">Taxpayer</p>
              <p className="text-white">{taxpayerName || '—'}</p>
              <p className="font-mono text-xs text-white/60">
                TIN: •••-••-{tinLast4(taxpayerTin)}
              </p>
              <p className="text-xs text-white/60">{taxpayerAddress || '—'}</p>
              {taxpayerPhone ? (
                <p className="text-xs text-white/60">{taxpayerPhone}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-white/40">Representative</p>
              <p className="text-white">{repName || '—'}</p>
              <p className="text-xs text-white/60">
                {repDesignation}
                {repJurisdiction ? ` · ${repJurisdiction}` : ''}
              </p>
              <p className="font-mono text-xs text-white/60">
                CAF: {repCaf || '—'} · PTIN: {repPtin || '—'}
              </p>
              <p className="text-xs text-white/60">{repPhone || '—'}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-white/40">
                Tax Matters ({matters.length})
              </p>
              <ul className="mt-1 space-y-1">
                {matters.map((m, i) => (
                  <li key={i} className="text-xs text-white/70">
                    {i + 1}. {m.description || '—'}
                    {m.tax_form ? ` · Form ${m.tax_form}` : ''}
                    {m.years_or_periods ? ` · ${m.years_or_periods}` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-white/40">Authorized Acts</p>
              <p className="mt-1 text-xs text-white/70">
                {[
                  accessRecords && 'Access records',
                  signDisclosure && 'Sign disclosure',
                  substituteReturn && 'Substitute rep',
                  signClaimRefund && 'Sign return / claim',
                  receiveRefund && 'Receive refund',
                  otherAuth && 'Other',
                ]
                  .filter(Boolean)
                  .join(' · ') || 'None selected'}
              </p>
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Link
              href={`/client-pool/${clientId}`}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FileText className="h-4 w-4" />
              {submitting ? 'Generating...' : 'Generate Form 2848 PDF'}
            </button>
          </div>
        </section>
      </fieldset>
    </div>
  )
}
