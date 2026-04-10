import type { Metadata } from 'next'
import {
  Plus,
  BookOpen,
  CircleDot,
  Clock,
  CheckCircle2,
  Headphones,
  Phone,
} from 'lucide-react'
import KPICard from '../components/KPICard'
import StatusBadge from '../components/StatusBadge'
import DataTable from '../components/DataTable'
import HeroCard from '../components/HeroCard'

export const metadata: Metadata = { title: 'Support' }

/* ── placeholder data ──────────────────────────────────────────── */

const ticketCounts = [
  { label: 'Open', value: '2', icon: CircleDot, change: '1 new this week', trend: 'up' as const },
  { label: 'Pending', value: '1', icon: Clock, change: 'Awaiting response', trend: 'neutral' as const },
  { label: 'Resolved', value: '8', icon: CheckCircle2, change: 'All time', trend: 'neutral' as const },
]

const ticketRows = [
  {
    subject: <a href="#" className="font-medium text-brand-orange hover:text-brand-amber transition">Token balance not updating after renewal</a>,
    category: 'Billing',
    status: <StatusBadge status="active" />,
    created: 'Apr 8, 2026',
    updated: 'Apr 9, 2026',
  },
  {
    subject: <a href="#" className="font-medium text-brand-orange hover:text-brand-amber transition">Calendar booking confirmation missing</a>,
    category: 'Bookings',
    status: <StatusBadge status="active" />,
    created: 'Apr 5, 2026',
    updated: 'Apr 7, 2026',
  },
  {
    subject: <a href="#" className="font-medium text-brand-orange hover:text-brand-amber transition">Request to update profile credentials</a>,
    category: 'Profile',
    status: <StatusBadge status="pending" />,
    created: 'Mar 28, 2026',
    updated: 'Apr 1, 2026',
  },
  {
    subject: <a href="#" className="font-medium text-brand-orange hover:text-brand-amber transition">Transcript report formatting issue</a>,
    category: 'Reports',
    status: <StatusBadge status="resolved" />,
    created: 'Mar 15, 2026',
    updated: 'Mar 18, 2026',
  },
  {
    subject: <a href="#" className="font-medium text-brand-orange hover:text-brand-amber transition">Upgrade plan from Active to Featured</a>,
    category: 'Billing',
    status: <StatusBadge status="resolved" />,
    created: 'Mar 1, 2026',
    updated: 'Mar 2, 2026',
  },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function SupportPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Support</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage support tickets and get help.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <a
          href="/support/create"
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Create New Ticket
        </a>
        <a
          href="/help"
          className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-5 py-2.5 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10"
        >
          <BookOpen className="h-4 w-4" />
          View Help Docs
        </a>
      </div>

      {/* Ticket Status Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        {ticketCounts.map((t) => (
          <KPICard key={t.label} {...t} />
        ))}
      </div>

      {/* Support Tickets table */}
      <div>
        <DataTable
          columns={[
            { key: 'subject', label: 'Subject' },
            { key: 'category', label: 'Category' },
            { key: 'status', label: 'Status' },
            { key: 'created', label: 'Created' },
            { key: 'updated', label: 'Last Update' },
          ]}
          rows={ticketRows}
        />
      </div>

      {/* Need Immediate Assistance */}
      <HeroCard>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-orange/20">
              <Headphones className="h-6 w-6 text-brand-orange" />
            </div>
            <div>
              <p className="text-lg font-semibold text-white">Need Immediate Assistance?</p>
              <p className="mt-1 text-sm text-white/50">
                Our support team typically responds within 2–4 hours during business hours (Mon–Fri, 9am–5pm PT).
              </p>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-white/40">
                <Phone className="h-3 w-3" />
                Phone support available for Premier members
              </div>
            </div>
          </div>
        </div>
      </HeroCard>
    </div>
  )
}
