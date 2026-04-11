'use client'

import { useEffect, useRef } from 'react'
import { Printer, Copy } from 'lucide-react'
import type { ComplianceData, TabId } from '../types'

interface Props {
  data: ComplianceData
  activeTab: TabId
  onCopySummary: () => void
}

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const s = String(value).trim()
  return s.length ? s : '—'
}

function yesNo(v: boolean): string {
  return v ? 'Authorized' : 'Not Authorized'
}

const TAB_LABELS: Record<TabId, string> = {
  overview: 'Overview',
  agent: 'Agent',
  authority: 'Authority',
  compliance: 'Compliance',
  notices: 'Notices',
  installment: 'Installment Agreement',
  revenue: 'Revenue Officer',
  transcripts: 'Transcripts',
  summary: 'Summary',
}

const SECTION_FOR_TAB: Partial<Record<TabId, string>> = {
  agent: 'agent',
  authority: 'authority',
  compliance: 'compliance',
  notices: 'notices',
  installment: 'installment',
  revenue: 'revenue',
  transcripts: 'transcripts',
  summary: 'summary',
}

export default function PreviewPanel({ data, activeTab, onCopySummary }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sectionKey = SECTION_FOR_TAB[activeTab]
    if (!sectionKey || !scrollRef.current) return
    const target = scrollRef.current.querySelector<HTMLElement>(
      `[data-preview-section="${sectionKey}"]`
    )
    if (!target) return
    scrollRef.current.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' })
  }, [activeTab])

  const activeSection = SECTION_FOR_TAB[activeTab]

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
            Preview
          </div>
          <div className="text-sm font-medium text-white">{TAB_LABELS[activeTab]}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10"
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
          <button
            type="button"
            onClick={onCopySummary}
            className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-brand-orange to-brand-amber px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
          >
            <Copy className="h-3.5 w-3.5" /> Copy Summary
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-4">
        <PreviewSection title="Agent" sectionId="agent" active={activeSection === 'agent'}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <PreviewField label="Enrolled Agent" value={data.agent_name} />
            <PreviewField label="CAF" value={data.caf_number} mono />
            <PreviewField label="PTIN" value={data.ptin} mono />
            <PreviewField label="POA Effective" value={data.poa_effective_date} mono />
          </div>
        </PreviewSection>

        <PreviewSection
          title="Authority"
          sectionId="authority"
          active={activeSection === 'authority'}
        >
          <div className="space-y-2 text-sm">
            <Row label="Receive Tax Information" value={yesNo(data.auth_receive_tax_info)} />
            <Row label="Represent Taxpayer" value={yesNo(data.auth_represent_taxpayer)} />
            <Row label="Sign Return" value={yesNo(data.auth_sign_return)} />
            <Row label="Receive Refund Checks" value={yesNo(data.auth_receive_refund)} />
          </div>
        </PreviewSection>

        <PreviewSection
          title="Compliance"
          sectionId="compliance"
          active={activeSection === 'compliance'}
        >
          <div className="space-y-2 text-sm">
            <Row label="Activity Type" value={dash(data.compliance_activity_type)} />
            <Row label="Period Covered" value={dash(data.compliance_period_covered)} />
            <div className="grid grid-cols-2 gap-3 pt-1">
              <PreviewField label="Return Filing Status" value={data.return_filing_status} />
              <PreviewField label="Date Filed" value={data.return_date_filed} mono />
              <PreviewField label="Tax Liability" value={data.return_tax_liability} mono />
              <PreviewField label="Tax Year" value={String(data.compliance_tax_year)} mono />
            </div>
            <div className="mt-2 rounded-lg border border-white/10 bg-[#0a0e27]/60 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                Internal Notes
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-white/80">
                {dash(data.compliance_internal_notes)}
              </div>
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          title="Notices"
          sectionId="notices"
          active={activeSection === 'notices'}
        >
          {data.notices.length === 0 ? (
            <div className="text-sm text-white/40">No notice entries yet.</div>
          ) : (
            <div className="space-y-2 text-sm">
              {data.notices.map((n, i) => (
                <div
                  key={i}
                  className="rounded-md border border-white/10 bg-[#0a0e27]/40 p-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-white">
                      {n.cp_number || n.type || `Notice ${i + 1}`}
                    </span>
                    <span className="text-xs text-white/40">{n.date || '—'}</span>
                  </div>
                  {n.details ? (
                    <p className="mt-1 line-clamp-2 text-xs text-white/60">{n.details}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </PreviewSection>

        <PreviewSection
          title="Installment Agreement"
          sectionId="installment"
          active={activeSection === 'installment'}
        >
          <div className="grid grid-cols-2 gap-3 text-sm">
            <PreviewField label="Established" value={data.ia_established} />
            <PreviewField label="Requested Payment" value={data.ia_payment_amount} mono />
            <PreviewField label="Next Due" value={data.ia_payment_date} mono />
            <PreviewField label="Last Payment" value={data.ia_last_payment_amount} mono />
          </div>
        </PreviewSection>

        <PreviewSection
          title="Revenue Officer"
          sectionId="revenue"
          active={activeSection === 'revenue'}
        >
          <div className="space-y-2 text-sm">
            <PreviewField label="Name" value={data.ro_name} />
            <div className="grid grid-cols-2 gap-3">
              <PreviewField label="Phone" value={data.ro_phone} mono />
              <PreviewField label="Email" value={data.ro_email} mono />
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                Notes
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-white/80">
                {dash(data.ro_notes)}
              </div>
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          title="Transcripts"
          sectionId="transcripts"
          active={activeSection === 'transcripts'}
        >
          <div className="grid grid-cols-2 gap-3 text-sm">
            <PreviewField
              label="Request Made"
              value={data.transcript_request_made ? 'Yes' : 'No'}
            />
            <PreviewField label="Delivery Method" value={data.transcript_delivery_method} />
            <PreviewField label="Scope Confirmed" value={data.transcript_scope_confirmed} />
            <PreviewField label="Retrieval Date" value={data.transcript_retrieval_date} mono />
            <div className="col-span-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                Notes
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-white/80">
                {dash(data.transcript_retrieval_notes)}
              </div>
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          title="Summary"
          sectionId="summary"
          active={activeSection === 'summary'}
        >
          <div className="rounded-lg border border-white/10 bg-[#0a0e27]/60 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
              Client-Facing Summary
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/80">
              {dash(data.compliance_client_summary)}
            </p>
          </div>
          <div className="mt-3 rounded-lg border border-white/10 bg-[#0a0e27]/60 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
              Internal Next Steps
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/80">
              {dash(data.compliance_internal_next_steps)}
            </p>
          </div>
        </PreviewSection>
      </div>
    </div>
  )
}

function PreviewSection({
  title,
  sectionId,
  active,
  children,
}: {
  title: string
  sectionId: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <section
      data-preview-section={sectionId}
      className={`rounded-lg border p-3 transition ${
        active
          ? 'border-brand-orange/40 bg-brand-orange/5 ring-2 ring-brand-orange/20'
          : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
        {title}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function PreviewField({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-white/40">{label}</div>
      <div className={mono ? 'font-mono text-white' : 'font-semibold text-white'}>
        {dash(value)}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/50">{label}</span>
      <span className="text-white">{dash(value)}</span>
    </div>
  )
}
