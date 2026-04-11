'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  User,
  CheckCircle2,
  FileSignature,
  Shield,
  FileText,
  Bell,
  History,
  CreditCard,
  UserCircle,
  FileSearch,
  ClipboardCheck,
} from 'lucide-react'

import {
  getComplianceRecord,
  saveComplianceRecord,
  type ComplianceRecord,
  type ComplianceRecordPayload,
} from '@/lib/api/compliance-records'
import AccordionSection from './components/AccordionSection'
import ComplianceHeader from './components/ComplianceHeader'
import ComplianceTabs from './components/ComplianceTabs'
import MFJBanner from './components/MFJBanner'
import NoticeEntry from './components/NoticeEntry'
import PreviewPanel from './components/PreviewPanel'
import SSNField from './components/SSNField'
import YearTabs from './components/YearTabs'
import {
  Checkbox,
  DateInput,
  Field,
  Grid2,
  Label,
  Pill,
  Select,
  TextArea,
  TextInput,
} from './components/FormPrimitives'
import {
  COMPLIANCE_ACTIVITY_TYPE_OPTIONS,
  COMPLIANCE_PERIOD_COVERED_OPTIONS,
  ESTIMATED_BALANCE_RANGE_OPTIONS,
  FILING_STATUS_OPTIONS,
  IA_ESTABLISHED_OPTIONS,
  INCLUDED_SECTION_OPTIONS,
  IRS_ACCOUNT_STATUS_OPTIONS,
  IRS_AGENT_DEPARTMENT_OPTIONS,
  IRS_AGENT_DEPARTMENT_PHONE_OPTIONS,
  IRS_LIEN_EXPOSURE_OPTIONS,
  IRS_MISSING_YEARS_OPTIONS,
  IRS_STATUS_CATEGORY_OPTIONS,
  RETURN_PROCESSING_STATUS_OPTIONS,
  STATE_OPTIONS,
  TRANSCRIPT_DELIVERY_OPTIONS,
  TRANSCRIPT_RETRIEVED_OPTIONS,
  TRANSCRIPT_SCOPE_OPTIONS,
  TRANSCRIPT_TYPE_OPTIONS,
  UNFILED_RETURNS_OPTIONS,
  emptyNotice,
  initialComplianceData,
  type ComplianceData,
  type TabId,
} from './types'

const MFJ_BANNER_STORAGE_KEY = 'vlp:compliance:mfj-banner-dismissed'

function mergeRecordIntoData(
  prev: ComplianceData,
  record: ComplianceRecord
): ComplianceData {
  const prevAsRecord = prev as unknown as Record<string, unknown>
  const source = record as unknown as Record<string, unknown>
  const next: Record<string, unknown> = { ...prevAsRecord }
  for (const key of Object.keys(prevAsRecord)) {
    const value = source[key]
    if (value !== undefined && value !== null) {
      next[key] = value
    }
  }
  if (record.order_id) next.order_id = record.order_id
  if (Array.isArray(record.notices)) {
    next.notices = record.notices.map((n) => ({
      received: typeof n.received === 'string' ? n.received : '',
      date: typeof n.date === 'string' ? n.date : '',
      type: typeof n.type === 'string' ? n.type : '',
      cp_number: typeof n.cp_number === 'string' ? n.cp_number : '',
      details: typeof n.details === 'string' ? n.details : '',
    }))
  }
  return next as unknown as ComplianceData
}

export default function ComplianceRecordPage() {
  const params = useParams<{ clientId: string }>()
  const clientId = params?.clientId ?? 'c1'

  const [data, setData] = useState<ComplianceData>(() => {
    const initial = initialComplianceData()
    return { ...initial, order_id: clientId }
  })
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [mfjBannerDismissed, setMfjBannerDismissed] = useState(false)
  const [mfjScope, setMfjScope] = useState<'primary' | 'spouse'>('primary')

  useEffect(() => {
    if (typeof window === 'undefined') return
    setMfjBannerDismissed(
      window.localStorage.getItem(MFJ_BANNER_STORAGE_KEY) === '1'
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await getComplianceRecord(clientId)
        if (cancelled) return
        if (res.ok && res.record) {
          setData((prev) => mergeRecordIntoData(prev, res.record!))
          if (res.record.updated_at) {
            setLastSavedAt(new Date(res.record.updated_at))
          }
        }
      } catch {
        // First-time record — initial defaults stand
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const showMfjBanner = data.filing_status === 'MFJ' && !mfjBannerDismissed

  function update<K extends keyof ComplianceData>(key: K, value: ComplianceData[K]) {
    setData((prev) => ({ ...prev, [key]: value }))
  }

  function toggleInArray<K extends keyof ComplianceData>(
    key: K,
    value: string,
    checked: boolean
  ) {
    setData((prev) => {
      const current = (prev[key] as unknown as string[]) ?? []
      const next = checked ? [...current, value] : current.filter((v) => v !== value)
      return { ...prev, [key]: next as unknown as ComplianceData[K] }
    })
  }

  function updateNotice(index: number, next: ReturnType<typeof emptyNotice>) {
    setData((prev) => {
      const notices = [...prev.notices]
      notices[index] = next
      return { ...prev, notices }
    })
  }

  function addNotice() {
    setData((prev) =>
      prev.notices.length >= 3
        ? prev
        : { ...prev, notices: [...prev.notices, emptyNotice()] }
    )
  }

  function removeNotice(index: number) {
    setData((prev) => ({
      ...prev,
      notices: prev.notices.filter((_, i) => i !== index),
    }))
  }

  function buildPayload() {
    return {
      account_id: data.account_id,
      order_id: data.order_id,
      servicing_professional_id: data.servicing_professional_id,
      source: data.source,
      client_name: data.client_name,
      ssn_last4: data.ssn_last4,
      filing_status: data.filing_status,
      state_of_residence: data.state_of_residence,
      total_irs_balance: data.total_irs_balance,
      irs_penalties_total: data.irs_penalties_total,
      irs_interest_total: data.irs_interest_total,
      irs_account_status: data.irs_account_status,
      estimated_balance_due_range: data.estimated_balance_due_range,
      irs_missing_years: data.irs_missing_years,
      unfiled_returns_indicator: data.unfiled_returns_indicator,
      irs_lien_exposure_level: data.irs_lien_exposure_level,
      irs_status_categories: data.irs_status_categories,
      irs_agent_department: data.irs_agent_department,
      irs_agent_department_phone: data.irs_agent_department_phone,
      irs_call_confirmation_date: data.irs_call_confirmation_date,
      irs_representative_name: data.irs_representative_name,
      irs_representative_badge_number: data.irs_representative_badge_number,
      irs_call_discussion_notes: data.irs_call_discussion_notes,
      irs_call_action_items: data.irs_call_action_items,
      agent_name: data.agent_name,
      caf_number: data.caf_number,
      ptin: data.ptin,
      poa_effective_date: data.poa_effective_date,
      tax_matters_authorized: data.tax_matters_authorized,
      auth_receive_tax_info: data.auth_receive_tax_info,
      auth_represent_taxpayer: data.auth_represent_taxpayer,
      auth_sign_return: data.auth_sign_return,
      auth_receive_refund: data.auth_receive_refund,
      compliance_tax_year: data.compliance_tax_year,
      compliance_activity_type: data.compliance_activity_type,
      compliance_period_covered: data.compliance_period_covered,
      compliance_internal_notes: data.compliance_internal_notes,
      return_processing_status: data.return_processing_status,
      return_date_filed: data.return_date_filed,
      return_filing_status: data.return_filing_status,
      return_tax_liability: data.return_tax_liability,
      notices: data.notices
        .filter((n) => n.received || n.type || n.details)
        .map((n) => ({
          received: n.received,
          date: n.date,
          type: n.type,
          cp_number: n.cp_number || null,
          details: n.details,
        })),
      ia_established: data.ia_established,
      ia_payment_amount: data.ia_payment_amount,
      ia_payment_date: data.ia_payment_date,
      ia_last_payment_amount: data.ia_last_payment_amount,
      ia_last_payment_date: data.ia_last_payment_date,
      ro_name: data.ro_name,
      ro_phone: data.ro_phone,
      ro_mobile_phone: data.ro_mobile_phone,
      ro_email: data.ro_email,
      ro_fax: data.ro_fax,
      ro_notes: data.ro_notes,
      transcript_request_made: data.transcript_request_made,
      transcript_delivery_method: data.transcript_delivery_method,
      transcript_scope_confirmed: data.transcript_scope_confirmed,
      transcripts_retrieved_from_sor: data.transcripts_retrieved_from_sor,
      transcript_retrieval_date: data.transcript_retrieval_date,
      transcript_retrieval_notes: data.transcript_retrieval_notes,
      compliance_client_summary: data.compliance_client_summary,
      compliance_internal_next_steps: data.compliance_internal_next_steps,
      compliance_record_status: data.compliance_record_status,
      compliance_prepared_date: data.compliance_prepared_date,
      compliance_included_sections: data.compliance_included_sections,
    }
  }

  async function handleSaveDraft() {
    if (saving) return
    setSaving(true)
    const payload: ComplianceRecordPayload = {
      ...buildPayload(),
      order_id: clientId,
      compliance_record_status: 'Draft',
    }
    try {
      const res = await saveComplianceRecord(payload)
      if (res.ok) {
        update('compliance_record_status', 'Draft')
        setLastSavedAt(res.updated_at ? new Date(res.updated_at) : new Date())
        showToast('Draft saved')
      } else if (res.error === 'record_finalized') {
        update('compliance_record_status', 'Final')
        showToast('Record is finalized and locked')
      } else {
        showToast(res.message || 'Save failed')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleFinalize() {
    if (saving) return
    const confirmed = window.confirm(
      'Finalize this compliance record? Once finalized, the record is locked and becomes the authoritative compliance document for this client.'
    )
    if (!confirmed) return
    setSaving(true)
    const payload: ComplianceRecordPayload = {
      ...buildPayload(),
      order_id: clientId,
      compliance_record_status: 'Final',
    }
    try {
      const res = await saveComplianceRecord(payload)
      if (res.ok) {
        update('compliance_record_status', 'Final')
        setLastSavedAt(res.updated_at ? new Date(res.updated_at) : new Date())
        showToast('Record finalized')
      } else if (res.error === 'record_finalized') {
        update('compliance_record_status', 'Final')
        showToast('Record is already finalized')
      } else {
        showToast(res.message || 'Finalize failed')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Finalize failed')
    } finally {
      setSaving(false)
    }
  }

  function handleCopySummary() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(data.compliance_client_summary || '').then(() => {
      showToast('Summary copied to clipboard')
    })
  }

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 2500)
  }

  function dismissMfjBanner() {
    setMfjBannerDismissed(true)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MFJ_BANNER_STORAGE_KEY, '1')
    }
  }

  const lastSavedLabel = useMemo(() => {
    if (!lastSavedAt) return 'not yet saved'
    const seconds = Math.floor((Date.now() - lastSavedAt.getTime()) / 1000)
    if (seconds < 10) return 'just now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    return lastSavedAt.toLocaleTimeString()
  }, [lastSavedAt])

  const finalized = data.compliance_record_status === 'Final'

  return (
    <div className="-m-8 min-h-[calc(100vh-80px)]">
      {showMfjBanner ? (
        <MFJBanner
          scope={mfjScope}
          onScopeChange={setMfjScope}
          onClose={dismissMfjBanner}
        />
      ) : null}

      <ComplianceHeader
        clientId={clientId}
        clientName={data.client_name}
        orderId={data.order_id}
        status={data.compliance_record_status}
        lastSavedLabel={lastSavedLabel}
        onSaveDraft={handleSaveDraft}
        onFinalize={handleFinalize}
        saving={saving || loading}
        finalized={finalized}
        mfjOffset={showMfjBanner}
      />

      <ComplianceTabs active={activeTab} onChange={setActiveTab} mfjOffset={showMfjBanner} />

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            <fieldset disabled={finalized} className="space-y-4">
              {activeTab === 'overview' ? <OverviewTab data={data} update={update} toggleInArray={toggleInArray} /> : null}
              {activeTab === 'agent' ? <AgentTab data={data} update={update} /> : null}
              {activeTab === 'authority' ? <AuthorityTab data={data} update={update} /> : null}
              {activeTab === 'compliance' ? <ComplianceTab data={data} update={update} /> : null}
              {activeTab === 'notices' ? (
                <NoticesTab
                  data={data}
                  updateNotice={updateNotice}
                  addNotice={addNotice}
                  removeNotice={removeNotice}
                />
              ) : null}
              {activeTab === 'installment' ? <InstallmentTab data={data} update={update} /> : null}
              {activeTab === 'revenue' ? <RevenueTab data={data} update={update} /> : null}
              {activeTab === 'transcripts' ? (
                <TranscriptsTab data={data} update={update} toggleInArray={toggleInArray} />
              ) : null}
              {activeTab === 'summary' ? (
                <SummaryTab data={data} update={update} toggleInArray={toggleInArray} />
              ) : null}
            </fieldset>
          </div>

          <aside className="lg:w-[420px] lg:shrink-0">
            <div className="lg:sticky lg:top-[180px] lg:max-h-[calc(100vh-200px)]">
              <div className="h-[calc(100vh-200px)] lg:h-auto lg:max-h-[calc(100vh-200px)]">
                <PreviewPanel
                  data={data}
                  activeTab={activeTab}
                  onCopySummary={handleCopySummary}
                />
              </div>
            </div>
          </aside>
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-sm font-medium text-white shadow-lg backdrop-blur">
          {toast}
        </div>
      ) : null}
    </div>
  )
}

/* ── Tab sections ───────────────────────────────────────────────── */

type UpdateFn = <K extends keyof ComplianceData>(key: K, value: ComplianceData[K]) => void
type ToggleArrayFn = <K extends keyof ComplianceData>(
  key: K,
  value: string,
  checked: boolean
) => void

function OverviewTab({
  data,
  update,
  toggleInArray,
}: {
  data: ComplianceData
  update: UpdateFn
  toggleInArray: ToggleArrayFn
}) {
  return (
    <>
      <AccordionSection icon={User} title="Client Information">
        <Grid2>
          <Field label="Full Legal Name">
            <TextInput
              value={data.client_name}
              onChange={(e) => update('client_name', e.target.value)}
            />
          </Field>
          <SSNField fullValue={data.ssn_full} last4={data.ssn_last4} />
          <Field label="Filing Status">
            <Select
              options={FILING_STATUS_OPTIONS}
              value={data.filing_status}
              onChange={(e) =>
                update('filing_status', e.target.value as ComplianceData['filing_status'])
              }
              placeholder="Select status..."
            />
          </Field>
          <Field label="State of Residence">
            <Select
              options={STATE_OPTIONS}
              value={data.state_of_residence}
              onChange={(e) => update('state_of_residence', e.target.value)}
              placeholder="Select state..."
            />
          </Field>
        </Grid2>
        <p className="mt-3 text-xs text-white/40">
          Verify client identity before discussing account details with IRS representative.
        </p>
      </AccordionSection>

      <AccordionSection icon={CheckCircle2} title="Account Status">
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <BalanceCard
            label="Total Balance"
            value={data.total_irs_balance}
            tone="red"
            onChange={(v) => update('total_irs_balance', v)}
          />
          <BalanceCard
            label="Penalties"
            value={data.irs_penalties_total}
            tone="amber"
            onChange={(v) => update('irs_penalties_total', v)}
          />
          <BalanceCard
            label="Interest"
            value={data.irs_interest_total}
            tone="amber"
            onChange={(v) => update('irs_interest_total', v)}
          />
        </div>

        <Grid2>
          <Field label="IRS Account Status">
            <Select
              options={IRS_ACCOUNT_STATUS_OPTIONS}
              value={data.irs_account_status}
              onChange={(e) => update('irs_account_status', e.target.value)}
            />
          </Field>
          <Field label="Estimated Balance Due Range">
            <Select
              options={ESTIMATED_BALANCE_RANGE_OPTIONS}
              value={data.estimated_balance_due_range}
              onChange={(e) => update('estimated_balance_due_range', e.target.value)}
            />
          </Field>
          <Field label="IRS Missing Years">
            <Select
              options={IRS_MISSING_YEARS_OPTIONS}
              value={data.irs_missing_years}
              onChange={(e) => update('irs_missing_years', e.target.value)}
            />
          </Field>
          <Field label="Unfiled Returns Indicator">
            <Select
              options={UNFILED_RETURNS_OPTIONS}
              value={data.unfiled_returns_indicator}
              onChange={(e) => update('unfiled_returns_indicator', e.target.value)}
            />
          </Field>
          <Field label="IRS Lien Exposure Level" span={2}>
            <Select
              options={IRS_LIEN_EXPOSURE_OPTIONS}
              value={data.irs_lien_exposure_level}
              onChange={(e) => update('irs_lien_exposure_level', e.target.value)}
            />
          </Field>
        </Grid2>

        <div className="mt-4">
          <Label>IRS Status Categories</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {IRS_STATUS_CATEGORY_OPTIONS.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/5 p-2 transition hover:bg-white/[0.07]"
              >
                <input
                  type="checkbox"
                  checked={data.irs_status_categories.includes(opt)}
                  onChange={(e) =>
                    toggleInArray('irs_status_categories', opt, e.target.checked)
                  }
                  className="h-4 w-4 rounded border-white/20 bg-white/5 text-brand-orange accent-brand-orange focus:ring-brand-orange/20"
                />
                <span className="text-sm text-white/80">{opt}</span>
              </label>
            ))}
          </div>
        </div>

        {data.irs_status_categories.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.irs_status_categories.includes('Collection') ? (
              <Pill tone="red">● Balance Due</Pill>
            ) : null}
            {data.unfiled_returns_indicator === 'Yes' ? (
              <Pill tone="amber">● Missing Returns</Pill>
            ) : null}
            {data.irs_lien_exposure_level?.startsWith('High') ? (
              <Pill tone="orange">● Lien Risk</Pill>
            ) : null}
          </div>
        ) : null}
      </AccordionSection>

      <AccordionSection
        icon={FileText}
        title="Call Notes"
        badge={{ label: 'Live', tone: 'orange' }}
      >
        <Grid2>
          <Field label="IRS Agent Department">
            <Select
              options={IRS_AGENT_DEPARTMENT_OPTIONS}
              value={data.irs_agent_department}
              onChange={(e) => update('irs_agent_department', e.target.value)}
            />
          </Field>
          <Field label="IRS Agent Department Phone">
            <Select
              options={IRS_AGENT_DEPARTMENT_PHONE_OPTIONS}
              value={data.irs_agent_department_phone}
              onChange={(e) => update('irs_agent_department_phone', e.target.value)}
            />
          </Field>
          <Field label="IRS Call Confirmation Date" span={2}>
            <DateInput
              value={data.irs_call_confirmation_date}
              onChange={(e) => update('irs_call_confirmation_date', e.target.value)}
            />
          </Field>
        </Grid2>

        <div className="mt-3 space-y-3">
          <Field label="IRS Representative">
            <TextInput
              placeholder="IRS Representative (First and Last Name)"
              value={data.irs_representative_name}
              onChange={(e) => update('irs_representative_name', e.target.value)}
            />
          </Field>
          <Field label="IRS Badge Number">
            <TextInput
              mono
              placeholder="IRS badge number"
              value={data.irs_representative_badge_number}
              onChange={(e) => update('irs_representative_badge_number', e.target.value)}
            />
          </Field>
          <Field label="Discussion Notes">
            <TextArea
              rows={4}
              placeholder="Document key points discussed..."
              value={data.irs_call_discussion_notes}
              onChange={(e) => update('irs_call_discussion_notes', e.target.value)}
            />
          </Field>
          <Field label="Action Items">
            <TextArea
              rows={2}
              placeholder="Required follow-up actions..."
              value={data.irs_call_action_items}
              onChange={(e) => update('irs_call_action_items', e.target.value)}
            />
          </Field>
        </div>

        <p className="mt-3 text-xs text-white/40">
          All call notes are timestamped and saved automatically.
        </p>
      </AccordionSection>
    </>
  )
}

function BalanceCard({
  label,
  value,
  tone,
  onChange,
}: {
  label: string
  value: string
  tone: 'red' | 'amber'
  onChange: (v: string) => void
}) {
  const toneClass = tone === 'red' ? 'text-red-400' : 'text-amber-400'
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
      <label className="block text-[10px] font-medium uppercase tracking-wider text-white/40">
        {label}
      </label>
      <input
        type="text"
        inputMode="decimal"
        placeholder="$0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full border-0 bg-transparent p-0 font-mono text-lg font-medium leading-7 focus:outline-none ${toneClass}`}
      />
    </div>
  )
}

function AgentTab({ data, update }: { data: ComplianceData; update: UpdateFn }) {
  return (
    <AccordionSection icon={FileSignature} title="Power of Attorney (Form 2848)">
      <Grid2>
        <Field label="Enrolled Agent Name">
          <TextInput
            value={data.agent_name}
            onChange={(e) => update('agent_name', e.target.value)}
          />
        </Field>
        <Field label="CAF Number">
          <TextInput
            mono
            value={data.caf_number}
            onChange={(e) => update('caf_number', e.target.value)}
          />
        </Field>
        <Field label="PTIN">
          <TextInput
            mono
            value={data.ptin}
            onChange={(e) => update('ptin', e.target.value)}
          />
        </Field>
        <Field label="POA Effective Date">
          <DateInput
            value={data.poa_effective_date}
            onChange={(e) => update('poa_effective_date', e.target.value)}
          />
        </Field>
        <Field label="Tax Matters Authorized" span={2}>
          <TextInput
            value={data.tax_matters_authorized}
            onChange={(e) => update('tax_matters_authorized', e.target.value)}
          />
        </Field>
      </Grid2>

      <div className="mt-4 flex items-center gap-2">
        <Pill tone="green">✓ Active on CAF</Pill>
        <span className="text-xs text-white/40">
          Verified {data.poa_effective_date || '—'}
        </span>
      </div>
    </AccordionSection>
  )
}

function AuthorityTab({ data, update }: { data: ComplianceData; update: UpdateFn }) {
  const rows: Array<{
    key: keyof ComplianceData
    title: string
    sub: string
  }> = [
    {
      key: 'auth_receive_tax_info',
      title: 'Receive Tax Information',
      sub: 'Access account transcripts and notices',
    },
    {
      key: 'auth_represent_taxpayer',
      title: 'Represent Taxpayer',
      sub: "Speak and negotiate on client's behalf",
    },
    {
      key: 'auth_sign_return',
      title: 'Sign Return',
      sub: 'Execute tax returns on behalf of taxpayer',
    },
    {
      key: 'auth_receive_refund',
      title: 'Receive Refund Checks',
      sub: "Accept refunds on taxpayer's behalf",
    },
  ]

  return (
    <AccordionSection icon={Shield} title="Authorization Scope">
      <div className="space-y-3">
        {rows.map((row) => {
          const authorized = data[row.key] as boolean
          return (
            <div
              key={row.key}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] p-3"
            >
              <div>
                <p className="text-sm font-medium text-white">{row.title}</p>
                <p className="text-xs text-white/40">{row.sub}</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  update(row.key, (!authorized) as unknown as ComplianceData[typeof row.key])
                }
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  authorized
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-white/5 text-white/50 hover:bg-white/10'
                }`}
              >
                {authorized ? 'Authorized' : 'Not Authorized'}
              </button>
            </div>
          )
        })}
      </div>
    </AccordionSection>
  )
}

function ComplianceTab({ data, update }: { data: ComplianceData; update: UpdateFn }) {
  return (
    <>
      <YearTabs
        selected={data.compliance_tax_year}
        onSelect={(y) => update('compliance_tax_year', y)}
      />

      <AccordionSection icon={ClipboardCheck} title="Compliance Record Inputs">
        <Grid2>
          <Field label="Compliance Activity Type">
            <Select
              options={COMPLIANCE_ACTIVITY_TYPE_OPTIONS}
              value={data.compliance_activity_type}
              onChange={(e) => update('compliance_activity_type', e.target.value)}
            />
          </Field>
          <Field label="Compliance Period Covered">
            <Select
              options={COMPLIANCE_PERIOD_COVERED_OPTIONS}
              value={data.compliance_period_covered}
              onChange={(e) => update('compliance_period_covered', e.target.value)}
            />
          </Field>
          <Field label="Compliance Internal Notes" span={2}>
            <TextArea
              rows={4}
              placeholder="Internal notes for this compliance record..."
              value={data.compliance_internal_notes}
              onChange={(e) => update('compliance_internal_notes', e.target.value)}
            />
          </Field>
        </Grid2>
        <p className="mt-3 text-xs text-white/40">
          This section is what actually gets written to canonical state.
        </p>
      </AccordionSection>

      <AccordionSection
        icon={FileText}
        title={`Return Status — ${data.compliance_tax_year}`}
      >
        <Grid2>
          <Field label="Processing Status">
            <Select
              options={RETURN_PROCESSING_STATUS_OPTIONS}
              value={data.return_processing_status}
              onChange={(e) => update('return_processing_status', e.target.value)}
            />
          </Field>
          <Field label="Date Filed">
            <DateInput
              value={data.return_date_filed}
              onChange={(e) => update('return_date_filed', e.target.value)}
            />
          </Field>
          <Field label="Filing Status">
            <Select
              options={FILING_STATUS_OPTIONS}
              value={data.return_filing_status}
              onChange={(e) =>
                update(
                  'return_filing_status',
                  e.target.value as ComplianceData['return_filing_status']
                )
              }
            />
          </Field>
          <Field label="Tax Liability">
            <TextInput
              mono
              value={data.return_tax_liability}
              onChange={(e) => update('return_tax_liability', e.target.value)}
            />
          </Field>
        </Grid2>
      </AccordionSection>
    </>
  )
}

function NoticesTab({
  data,
  updateNotice,
  addNotice,
  removeNotice,
}: {
  data: ComplianceData
  updateNotice: (index: number, next: ReturnType<typeof emptyNotice>) => void
  addNotice: () => void
  removeNotice: (index: number) => void
}) {
  return (
    <>
      <AccordionSection icon={Bell} title="Notice Entries">
        <p className="mb-4 text-xs text-white/40">
          Up to 3 entries. Entry #1 is the primary record mirrored to canonical notice
          fields.
        </p>
        <div className="space-y-4">
          {data.notices.map((entry, i) => (
            <NoticeEntry
              key={i}
              index={i + 1}
              entry={entry}
              onChange={(next) => updateNotice(i, next)}
              onRemove={i > 0 ? () => removeNotice(i) : undefined}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={addNotice}
            disabled={data.notices.length >= 3}
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Notice Entry
          </button>
          <span className="text-xs text-white/40">{data.notices.length} / 3</span>
        </div>
      </AccordionSection>

      <AccordionSection
        icon={History}
        title="Notice History"
        badge={{ label: '3 Active', tone: 'red' }}
      >
        <div className="space-y-3">
          <HistoryRow
            cp="CP504"
            tone="red"
            urgency="Urgent"
            title="Notice of Intent to Levy"
            deadline="Response deadline: Jan 28, 2025"
            date="Dec 14, 2024"
          />
          <HistoryRow
            cp="CP2000"
            tone="amber"
            urgency="Pending"
            title="Underreported Income - TY2023"
            deadline="Response deadline: Feb 15, 2025"
            date="Nov 20, 2024"
          />
          <HistoryRow
            cp="CP14"
            tone="neutral"
            urgency="Resolved"
            title="Balance Due Notice - TY2022"
            deadline="Paid in full: Oct 1, 2024"
            date="Aug 15, 2024"
          />
        </div>
      </AccordionSection>
    </>
  )
}

function HistoryRow({
  cp,
  tone,
  urgency,
  title,
  deadline,
  date,
}: {
  cp: string
  tone: 'red' | 'amber' | 'neutral'
  urgency: string
  title: string
  deadline: string
  date: string
}) {
  const toneClass: Record<string, string> = {
    red: 'bg-red-500/10 border-red-500/30',
    amber: 'bg-amber-500/10 border-amber-500/30',
    neutral: 'bg-white/5 border-white/10',
  }
  const urgencyClass: Record<string, string> = {
    red: 'bg-red-500/30 text-red-400',
    amber: 'bg-amber-500/30 text-amber-400',
    neutral: 'bg-green-500/30 text-green-400',
  }
  return (
    <div className={`rounded-lg border p-3 ${toneClass[tone]}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-white">{cp}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${urgencyClass[tone]}`}>
              {urgency}
            </span>
          </div>
          <p className="mt-1 text-sm text-white/60">{title}</p>
          <p className="mt-0.5 text-xs text-white/40">{deadline}</p>
        </div>
        <span className="text-xs text-white/40">{date}</span>
      </div>
    </div>
  )
}

function InstallmentTab({ data, update }: { data: ComplianceData; update: UpdateFn }) {
  return (
    <AccordionSection icon={CreditCard} title="Installment Agreement Status">
      <Grid2>
        <Field label="IA Established">
          <Select
            options={IA_ESTABLISHED_OPTIONS}
            value={data.ia_established}
            onChange={(e) => update('ia_established', e.target.value)}
          />
        </Field>
        <Field label="Requested Payment">
          <TextInput
            mono
            placeholder="$0.00"
            value={data.ia_payment_amount}
            onChange={(e) => update('ia_payment_amount', e.target.value)}
          />
        </Field>
        <Field label="Next Payment Due (Date)">
          <DateInput
            value={data.ia_payment_date}
            onChange={(e) => update('ia_payment_date', e.target.value)}
          />
        </Field>
        <Field label="Last Payment Amount">
          <TextInput
            mono
            placeholder="$0.00"
            value={data.ia_last_payment_amount}
            onChange={(e) => update('ia_last_payment_amount', e.target.value)}
          />
        </Field>
        <Field label="Last Payment Date" span={2}>
          <DateInput
            value={data.ia_last_payment_date}
            onChange={(e) => update('ia_last_payment_date', e.target.value)}
          />
        </Field>
      </Grid2>
      <p className="mt-3 text-xs text-white/40">
        Form 9465 or online payment agreement may be required.
      </p>
    </AccordionSection>
  )
}

function RevenueTab({ data, update }: { data: ComplianceData; update: UpdateFn }) {
  return (
    <AccordionSection icon={UserCircle} title="Revenue Officer Assignment">
      <Grid2>
        <Field label="Revenue Officer Name">
          <TextInput
            placeholder="Name"
            value={data.ro_name}
            onChange={(e) => update('ro_name', e.target.value)}
          />
        </Field>
        <Field label="Phone">
          <TextInput
            placeholder="Phone"
            value={data.ro_phone}
            onChange={(e) => update('ro_phone', e.target.value)}
          />
        </Field>
        <Field label="Mobile Phone">
          <TextInput
            placeholder="Mobile"
            value={data.ro_mobile_phone}
            onChange={(e) => update('ro_mobile_phone', e.target.value)}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            placeholder="Email"
            value={data.ro_email}
            onChange={(e) => update('ro_email', e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
          />
        </Field>
        <Field label="Fax">
          <TextInput
            placeholder="Fax"
            value={data.ro_fax}
            onChange={(e) => update('ro_fax', e.target.value)}
          />
        </Field>
        <Field label="Notes" span={2}>
          <TextArea
            rows={3}
            placeholder="Notes about RO assignment..."
            value={data.ro_notes}
            onChange={(e) => update('ro_notes', e.target.value)}
          />
        </Field>
      </Grid2>
      <p className="mt-3 text-xs text-white/40">
        If no RO assigned, leave blank. Blank is a valid state.
      </p>
    </AccordionSection>
  )
}

function TranscriptsTab({
  data,
  update,
  toggleInArray,
}: {
  data: ComplianceData
  update: UpdateFn
  toggleInArray: ToggleArrayFn
}) {
  return (
    <AccordionSection icon={FileSearch} title="Transcript Requests">
      <div className="mb-4 flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={data.transcript_request_made}
            onChange={(e) => update('transcript_request_made', e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-white/5 text-brand-orange accent-brand-orange focus:ring-brand-orange/20"
          />
          <span className="text-sm text-white/80">Transcript Request Made</span>
        </label>
        <span className="text-xs text-white/40">Canonical checkbox</span>
      </div>

      <Grid2>
        <Field label="Transcript Delivery Method">
          <Select
            options={TRANSCRIPT_DELIVERY_OPTIONS}
            value={data.transcript_delivery_method}
            onChange={(e) => update('transcript_delivery_method', e.target.value)}
          />
        </Field>
        <Field label="Transcript Scope Confirmed">
          <Select
            options={TRANSCRIPT_SCOPE_OPTIONS}
            value={data.transcript_scope_confirmed}
            onChange={(e) => update('transcript_scope_confirmed', e.target.value)}
          />
        </Field>
        <Field label="Transcripts Retrieved From SOR">
          <Select
            options={TRANSCRIPT_RETRIEVED_OPTIONS}
            value={data.transcripts_retrieved_from_sor}
            onChange={(e) => update('transcripts_retrieved_from_sor', e.target.value)}
          />
        </Field>
        <Field label="Transcript Retrieval Date">
          <DateInput
            value={data.transcript_retrieval_date}
            onChange={(e) => update('transcript_retrieval_date', e.target.value)}
          />
        </Field>
        <Field label="Transcript Retrieval Notes" span={2}>
          <TextArea
            rows={3}
            placeholder="Retrieval notes..."
            value={data.transcript_retrieval_notes}
            onChange={(e) => update('transcript_retrieval_notes', e.target.value)}
          />
        </Field>
        <Field label="Transcript Files Upload" span={2}>
          <input
            type="file"
            multiple
            disabled
            className="w-full cursor-not-allowed rounded-md border border-dashed border-white/10 bg-white/5 px-3 py-2 text-sm text-white/50"
          />
          <p className="mt-2 text-xs text-white/40">
            Upload pipeline wired in Phase D — metadata only for now.
          </p>
        </Field>
      </Grid2>

      <div className="mt-4">
        <Label>Transcript Types Requested</Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TRANSCRIPT_TYPE_OPTIONS.map((opt) => (
            <Checkbox
              key={opt.value}
              checked={data.transcript_types.includes(opt.value)}
              onChange={(v) => toggleInArray('transcript_types', opt.value, v)}
              label={opt.label}
              sub={opt.sub}
            />
          ))}
        </div>
      </div>
    </AccordionSection>
  )
}

function SummaryTab({
  data,
  update,
  toggleInArray,
}: {
  data: ComplianceData
  update: UpdateFn
  toggleInArray: ToggleArrayFn
}) {
  return (
    <AccordionSection icon={ClipboardCheck} title="Case Summary">
      <div className="space-y-4">
        <Field label="Client-Facing Summary">
          <TextArea
            rows={5}
            placeholder="Short, client-friendly summary of current compliance status..."
            value={data.compliance_client_summary}
            onChange={(e) => update('compliance_client_summary', e.target.value)}
          />
        </Field>
        <Field label="Internal Next Steps">
          <TextArea
            rows={4}
            placeholder="What staff should do next..."
            value={data.compliance_internal_next_steps}
            onChange={(e) => update('compliance_internal_next_steps', e.target.value)}
          />
        </Field>

        <Grid2>
          <Field label="Record Status">
            <Select
              options={['Draft', 'Final']}
              value={data.compliance_record_status}
              onChange={(e) =>
                update(
                  'compliance_record_status',
                  e.target.value as ComplianceData['compliance_record_status']
                )
              }
            />
          </Field>
          <Field label="Prepared Date">
            <DateInput
              value={data.compliance_prepared_date}
              onChange={(e) => update('compliance_prepared_date', e.target.value)}
            />
          </Field>
        </Grid2>

        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
            Included Sections
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {INCLUDED_SECTION_OPTIONS.map((section) => (
              <label
                key={section}
                className="flex items-center gap-2 text-sm text-white/80"
              >
                <input
                  type="checkbox"
                  checked={data.compliance_included_sections.includes(section)}
                  onChange={(e) =>
                    toggleInArray('compliance_included_sections', section, e.target.checked)
                  }
                  className="h-4 w-4 rounded border-white/20 bg-white/5 text-brand-orange accent-brand-orange focus:ring-brand-orange/20"
                />
                {section}
              </label>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-white/40">
        Finalize will mark the compliance record as submitted (canonical).
      </p>
    </AccordionSection>
  )
}
