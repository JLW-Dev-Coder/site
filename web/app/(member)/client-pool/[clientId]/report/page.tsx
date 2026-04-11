'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ArrowLeft,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  DollarSign,
  ShieldCheck,
  ClipboardList,
} from 'lucide-react'

/* ── placeholder data (client-safe projection of compliance record) ─── */

const reportData = {
  client_name: 'Margaret Chen',
  order_id: 'TC-2024-00847',
  prepared_date: '2026-04-08',
  state_of_residence: 'California',
  filing_status: 'SINGLE',

  total_irs_balance: '$24,847.32',
  irs_penalties_total: '$3,218.00',
  irs_interest_total: '$1,842.17',
  irs_account_status: 'Non-Compliant',
  estimated_balance_due_range: '$10,000–$25,000',
  irs_missing_years: 'Missing within 10-year window',
  unfiled_returns_indicator: 'Yes',
  irs_lien_exposure_level: 'Moderate — balance or status requires monitoring',
  irs_status_categories: ['Collection', 'Notice'],

  compliance_tax_year: 2026,
  compliance_activity_type: 'Filing compliance review',
  compliance_period_covered: 'Initial 10-year review',

  return_processing_status: 'Filed - Accepted',
  return_date_filed: '2024-04-15',
  return_filing_status: 'SINGLE',
  return_tax_liability: '$28,340',

  notices: [
    {
      received: 'Yes',
      date: '2024-12-14',
      type: 'CP (Computer Paragraph Notice)',
      cp_number: 'CP504',
      details:
        'Notice of Intent to Levy — $24,847.32 balance due. Response deadline Jan 28, 2025.',
    },
    {
      received: 'Yes',
      date: '2024-11-20',
      type: 'CP (Computer Paragraph Notice)',
      cp_number: 'CP2000',
      details:
        'Underreported income flagged on TY2023. Proposed adjustment $4,218. Response deadline Feb 15, 2025.',
    },
    {
      received: 'Yes',
      date: '2024-08-15',
      type: 'CP (Computer Paragraph Notice)',
      cp_number: 'CP14',
      details: 'Balance due notice TY2022. Paid in full Oct 1, 2024.',
    },
  ],

  ia_established: 'No',

  compliance_client_summary:
    "Your IRS account currently shows a balance of $24,847.32 across 2022 and 2023. We've pulled transcripts, confirmed your filing status, and identified the active CP504 as the highest priority. Our next step is to submit an Installment Agreement request so collection activity is paused while we work through the CP2000 response.",
  compliance_included_sections: [
    'Account Status',
    'Call Notes',
    'Notices',
    'Transcripts',
  ],
}

/* ── page ─────────────────────────────────────────────────────────── */

export default function ComplianceReportPage() {
  const params = useParams<{ clientId: string }>()
  const clientId = params?.clientId ?? 'c1'

  const handleMarkReady = () => {
    console.log('Mark Report Ready clicked for client:', clientId, reportData.order_id)
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={`/client-pool/${clientId}`}
        className="inline-flex items-center gap-1.5 text-sm text-brand-orange transition hover:text-brand-amber"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Client Record
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Compliance Report</h1>
          <p className="mt-1 text-sm text-white/40">
            Client-visible report preview — review before marking final.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-amber-400">
          <ClipboardList className="h-3.5 w-3.5" />
          Draft Preview
        </span>
      </div>

      {/* Report shell — styled like the TMP client-facing report */}
      <div className="overflow-hidden rounded-2xl border border-[--member-border] bg-[--member-card]">
        {/* Client / order header */}
        <div className="border-b border-[--member-border] bg-white/5 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                Prepared for
              </p>
              <p className="mt-0.5 text-xl font-semibold text-white">
                {reportData.client_name}
              </p>
            </div>
            <div className="flex flex-wrap gap-6 text-xs">
              <div>
                <p className="font-medium uppercase tracking-wider text-white/40">Order</p>
                <p className="mt-0.5 font-mono text-white/70">{reportData.order_id}</p>
              </div>
              <div>
                <p className="font-medium uppercase tracking-wider text-white/40">Prepared</p>
                <p className="mt-0.5 text-white/70">{reportData.prepared_date}</p>
              </div>
              <div>
                <p className="font-medium uppercase tracking-wider text-white/40">Tax Year</p>
                <p className="mt-0.5 text-white/70">{reportData.compliance_tax_year}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Summary */}
        <Section icon={FileText} title="Summary">
          <p className="text-sm leading-relaxed text-white/70">
            {reportData.compliance_client_summary}
          </p>
        </Section>

        {/* Account Status */}
        <Section icon={DollarSign} title="IRS Account Status">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="Total IRS Balance" value={reportData.total_irs_balance} emphasis />
            <Metric label="Penalties" value={reportData.irs_penalties_total} />
            <Metric label="Interest" value={reportData.irs_interest_total} />
            <Metric label="Account Status" value={reportData.irs_account_status} />
            <Metric label="Estimated Range" value={reportData.estimated_balance_due_range} />
            <Metric label="Lien Exposure" value={reportData.irs_lien_exposure_level} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {reportData.irs_status_categories.map((cat) => (
              <span
                key={cat}
                className="inline-flex items-center rounded-full border border-brand-orange/30 bg-brand-orange/10 px-2.5 py-0.5 text-xs font-medium text-brand-orange"
              >
                {cat}
              </span>
            ))}
          </div>
        </Section>

        {/* Filing / Return */}
        <Section icon={ShieldCheck} title="Filing & Return Status">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="Filing Status" value={reportData.filing_status} />
            <Metric label="State of Residence" value={reportData.state_of_residence} />
            <Metric label="Return Processing" value={reportData.return_processing_status} />
            <Metric label="Date Filed" value={reportData.return_date_filed} />
            <Metric label="Tax Liability" value={reportData.return_tax_liability} />
            <Metric label="Unfiled Returns" value={reportData.unfiled_returns_indicator} />
          </div>
        </Section>

        {/* Notices */}
        <Section icon={AlertTriangle} title="IRS Notices">
          <div className="space-y-3">
            {reportData.notices.map((notice, i) => (
              <div
                key={`${notice.cp_number}-${i}`}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400">
                      {notice.cp_number}
                    </span>
                    <span className="text-xs text-white/40">{notice.type}</span>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-white/40">
                    <Calendar className="h-3 w-3" />
                    {notice.date}
                  </span>
                </div>
                <p className="mt-2 text-sm text-white/70">{notice.details}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Installment Agreement */}
        <Section icon={ClipboardList} title="Installment Agreement">
          <Metric label="IA Established" value={reportData.ia_established} />
        </Section>

        {/* Included Sections */}
        <Section icon={CheckCircle2} title="Included In This Report">
          <div className="flex flex-wrap gap-2">
            {reportData.compliance_included_sections.map((section) => (
              <span
                key={section}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400"
              >
                <CheckCircle2 className="h-3 w-3" />
                {section}
              </span>
            ))}
          </div>
        </Section>
      </div>

      {/* Mark Report Ready button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleMarkReady}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-orange/20 transition hover:opacity-90"
        >
          <CheckCircle2 className="h-4 w-4" />
          Mark Report Ready
        </button>
      </div>
    </div>
  )
}

/* ── helpers ─────────────────────────────────────────────────────── */

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-[--member-border] px-6 py-5 last:border-b-0">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-orange" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

function Metric({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">{label}</p>
      <p
        className={`mt-1 ${
          emphasis ? 'text-lg font-semibold text-brand-orange' : 'text-sm text-white/80'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
