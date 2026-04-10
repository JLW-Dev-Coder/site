import type { Metadata } from 'next'
import {
  DollarSign,
  Clock,
  Landmark,
  ShieldCheck,
  Inbox,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import StatusBadge from '../components/StatusBadge'

export const metadata: Metadata = { title: 'Payouts' }

/* ── placeholder data ──────────────────────────────────────────── */

const earningsColumns = [
  { key: 'client', label: 'Client Name' },
  { key: 'plan', label: 'Service Plan' },
  { key: 'fee', label: 'Plan Fee' },
  { key: 'platformFee', label: 'Platform Fee (12%)' },
  { key: 'payout', label: 'Your Payout' },
  { key: 'status', label: 'Status' },
]

const earningsRows = [
  { client: 'Maria Rivera', plan: 'Gold', fee: '$504', platformFee: '$60.48', payout: '$443.52', status: 'Active' },
  { client: 'David Chen', plan: 'Silver', fee: '$325', platformFee: '$39.00', payout: '$286.00', status: 'Active' },
  { client: 'Sofia Martinez', plan: 'Bronze', fee: '$275', platformFee: '$33.00', payout: '$242.00', status: 'Pending' },
  { client: 'Robert Thompson', plan: 'Gold', fee: '$504', platformFee: '$60.48', payout: '$443.52', status: 'Active' },
  { client: 'Arjun Patel', plan: 'Snapshot', fee: '$425', platformFee: '$51.00', payout: '$374.00', status: 'Completed' },
  { client: 'Linda Park', plan: 'Bronze', fee: '$275', platformFee: '$33.00', payout: '$242.00', status: 'Pending' },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function PayoutsPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Payouts</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage and track your earnings from Client Pool services.
        </p>
      </div>

      {/* Earnings Summary — 2-column grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Total Pending Payout */}
        <HeroCard>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-brand-orange" />
            <h3 className="text-xs uppercase tracking-widest text-brand-orange/70">Total Pending Payout</h3>
          </div>
          <p className="mt-4 text-4xl font-bold text-white">$1,370.52</p>
          <p className="mt-2 text-sm text-white/50">From 6 active client engagements</p>
          <button className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white shadow transition hover:opacity-90">
            Request Payout
          </button>
        </HeroCard>

        {/* Payout Status */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-white/30" />
            <h3 className="text-xs uppercase tracking-widest text-white/40">Payout Status</h3>
          </div>
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Last Payout</span>
              <span className="text-sm font-medium text-white/70">Never</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Bank Status</span>
              <StatusBadge status="Pending" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Minimum Threshold</span>
              <span className="text-sm font-medium text-white/70">$500</span>
            </div>
          </div>
        </div>
      </div>

      {/* Connect Bank Account */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-orange/10">
            <Landmark className="h-7 w-7 text-brand-orange" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">Connect your bank account</h3>
            <p className="mt-1 text-sm text-white/50">
              Link your bank account via Stripe to receive Client Pool payouts directly.
            </p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90">
            Connect Bank Account
          </button>
        </div>
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p className="text-sm text-emerald-400/80">
            Your bank information is encrypted and secure.
          </p>
        </div>
      </div>

      {/* Current Earnings table */}
      <div>
        <div className="mb-4">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Current Earnings</h3>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[--member-border] bg-[--member-card]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[--member-border]">
                {earningsColumns.map((col) => (
                  <th
                    key={col.key}
                    className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {earningsRows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-[--member-border] last:border-b-0 transition hover:bg-[--member-card-hover]"
                >
                  <td className="px-5 py-3.5 font-medium text-white">{row.client}</td>
                  <td className="px-5 py-3.5 text-white/70">{row.plan}</td>
                  <td className="px-5 py-3.5 text-white/70">{row.fee}</td>
                  <td className="px-5 py-3.5 text-white/70">{row.platformFee}</td>
                  <td className="px-5 py-3.5 font-medium text-brand-orange">{row.payout}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payout History — empty state */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Payout History</h3>
        <div className="mt-8 flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
            <Inbox className="h-6 w-6 text-white/20" />
          </div>
          <p className="text-sm text-white/40">
            No payout history yet &mdash; Complete your first client engagement to request a payout.
          </p>
        </div>
      </div>
    </div>
  )
}
