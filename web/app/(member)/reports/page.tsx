import type { Metadata } from 'next'
import {
  FileText,
  Download,
  Share2,
  Calendar,
  User,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'

export const metadata: Metadata = { title: 'Reports' }

/* ── placeholder data ──────────────────────────────────────────── */

const featuredReport = {
  title: 'IRS Transcript Analysis — Martinez LLC',
  client: 'Sofia Martinez',
  date: 'April 8, 2026',
}

const reportColumns = [
  { key: 'name', label: 'Report Name' },
  { key: 'client', label: 'Client' },
  { key: 'type', label: 'Type' },
  { key: 'generated', label: 'Generated' },
  { key: 'status', label: 'Status' },
  { key: 'size', label: 'Size', className: 'text-right' },
]

const reportRows = [
  {
    name: <span className="font-medium text-white">IRS Transcript Analysis — Martinez LLC</span>,
    client: 'Sofia Martinez',
    type: 'Transcript',
    generated: 'Apr 8, 2026',
    status: <StatusBadge status="Completed" />,
    size: '2.4 MB',
  },
  {
    name: <span className="font-medium text-white">Form 2848 POA — Chen & Associates</span>,
    client: 'David Chen',
    type: 'POA',
    generated: 'Apr 5, 2026',
    status: <StatusBadge status="Completed" />,
    size: '1.1 MB',
  },
  {
    name: <span className="font-medium text-white">Wage & Income Summary — Thompson Trust</span>,
    client: 'Robert Thompson',
    type: 'Transcript',
    generated: 'Apr 2, 2026',
    status: <StatusBadge status="Completed" />,
    size: '3.8 MB',
  },
  {
    name: <span className="font-medium text-white">Account Transcript — Rivera Holdings</span>,
    client: 'Maria Rivera',
    type: 'Transcript',
    generated: 'Mar 29, 2026',
    status: <StatusBadge status="Pending" />,
    size: '—',
  },
  {
    name: <span className="font-medium text-white">Form 8821 Authorization — Patel Group</span>,
    client: 'Arjun Patel',
    type: 'Authorization',
    generated: 'Mar 25, 2026',
    status: <StatusBadge status="Completed" />,
    size: '0.8 MB',
  },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Reports</h1>
        <p className="mt-1 text-sm text-white/50">
          Transcript reports and documentation history.
        </p>
      </div>

      {/* Featured report hero card */}
      <HeroCard>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-orange/70">Most Recent Report</p>
            <h2 className="mt-2 text-xl font-semibold text-white">{featuredReport.title}</h2>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-white/60">
              <span className="inline-flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-white/40" />
                <span className="text-white/40">Prepared for:</span>{' '}
                <span className="text-white/80">{featuredReport.client}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-white/40" />
                <span className="text-white/40">Generated:</span>{' '}
                <span className="text-white/80">{featuredReport.date}</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white shadow transition hover:opacity-90">
              <Download className="h-4 w-4" />
              Download
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10">
              <Share2 className="h-4 w-4" />
              Share
            </button>
          </div>
        </div>
      </HeroCard>

      {/* Report History */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-white/30" />
          <h3 className="text-xs uppercase tracking-widest text-white/40">Report History</h3>
        </div>
        <DataTable columns={reportColumns} rows={reportRows} />
      </div>
    </div>
  )
}
