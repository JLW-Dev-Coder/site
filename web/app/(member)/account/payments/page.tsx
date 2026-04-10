import type { Metadata } from 'next'
import {
  ArrowLeft,
  CreditCard,
  Download,
  Receipt,
} from 'lucide-react'
import StatusBadge from '../../components/StatusBadge'
import DataTable from '../../components/DataTable'

export const metadata: Metadata = { title: 'Payments' }

/* ── placeholder data ──────────────────────────────────────────── */

const paymentRows = [
  {
    date: 'Apr 4, 2026',
    description: <span className="font-medium text-white">Featured Plan — Monthly Renewal</span>,
    amount: '$199.00',
    status: <StatusBadge status="completed" />,
    receipt: (
      <button className="inline-flex items-center gap-1 text-brand-orange transition hover:text-brand-amber">
        <Download className="h-3.5 w-3.5" />
        PDF
      </button>
    ),
  },
  {
    date: 'Mar 28, 2026',
    description: <span className="font-medium text-white">Token Refill — 10 Transcript Tokens</span>,
    amount: '$49.00',
    status: <StatusBadge status="completed" />,
    receipt: (
      <button className="inline-flex items-center gap-1 text-brand-orange transition hover:text-brand-amber">
        <Download className="h-3.5 w-3.5" />
        PDF
      </button>
    ),
  },
  {
    date: 'Mar 4, 2026',
    description: <span className="font-medium text-white">Featured Plan — Monthly Renewal</span>,
    amount: '$199.00',
    status: <StatusBadge status="completed" />,
    receipt: (
      <button className="inline-flex items-center gap-1 text-brand-orange transition hover:text-brand-amber">
        <Download className="h-3.5 w-3.5" />
        PDF
      </button>
    ),
  },
  {
    date: 'Feb 4, 2026',
    description: <span className="font-medium text-white">Featured Plan — Monthly Renewal</span>,
    amount: '$199.00',
    status: <StatusBadge status="completed" />,
    receipt: (
      <button className="inline-flex items-center gap-1 text-brand-orange transition hover:text-brand-amber">
        <Download className="h-3.5 w-3.5" />
        PDF
      </button>
    ),
  },
  {
    date: 'Jan 15, 2026',
    description: <span className="font-medium text-white">Featured Plan — Initial Purchase</span>,
    amount: '$199.00',
    status: <StatusBadge status="completed" />,
    receipt: (
      <button className="inline-flex items-center gap-1 text-brand-orange transition hover:text-brand-amber">
        <Download className="h-3.5 w-3.5" />
        PDF
      </button>
    ),
  },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function PaymentsPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <a
          href="/account"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-white/40 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Account
        </a>
        <h1 className="text-2xl font-semibold text-white">Payments</h1>
        <p className="mt-1 text-sm text-white/50">
          Payment history and billing details.
        </p>
      </div>

      {/* Payment Method */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Payment Method</h3>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
              <CreditCard className="h-4 w-4 text-brand-orange" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Visa ending in 4242</p>
              <p className="text-xs text-white/40">Expires 12/2028</p>
            </div>
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10">
            Update
          </button>
        </div>
      </div>

      {/* Payment History */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-white/30" />
          <h3 className="text-xs uppercase tracking-widest text-white/40">Payment History</h3>
        </div>
        <DataTable
          columns={[
            { key: 'date', label: 'Date' },
            { key: 'description', label: 'Description' },
            { key: 'amount', label: 'Amount' },
            { key: 'status', label: 'Status' },
            { key: 'receipt', label: 'Receipt' },
          ]}
          rows={paymentRows}
        />
      </div>
    </div>
  )
}
