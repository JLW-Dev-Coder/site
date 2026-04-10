import type { Metadata } from 'next'
import Link from 'next/link'
import { Info, ArrowRight } from 'lucide-react'
import HeroCard from '../components/HeroCard'
import StatusBadge from '../components/StatusBadge'

export const metadata: Metadata = { title: 'Client Pool' }

/* ── placeholder data ──────────────────────────────────────────── */

const servicePlans = [
  {
    name: 'Bronze',
    price: '$275',
    duration: '6 weeks',
    description: 'Standard IRS transcript monitoring with bi-weekly pulls and summary reporting.',
    mfj: 'Add MFJ spouse: +$79',
  },
  {
    name: 'Silver',
    price: '$325',
    duration: '8 weeks',
    description: 'Extended monitoring with weekly pulls, detailed analysis, and priority support.',
    mfj: 'Add MFJ spouse: +$79',
  },
  {
    name: 'Gold',
    price: '$425',
    duration: '12 weeks',
    description: 'Comprehensive monitoring with weekly pulls, full analysis, alerts, and dedicated support.',
    mfj: 'Add MFJ spouse: +$79',
  },
  {
    name: 'Snapshot',
    price: '$425',
    duration: 'One-time pull',
    description: 'Single comprehensive transcript pull with full analysis report. No ongoing monitoring.',
    mfj: 'Add MFJ spouse: +$79',
  },
]

const columns = [
  { key: 'client', label: 'Client Name' },
  { key: 'plan', label: 'Service Plan' },
  { key: 'filing', label: 'Filing Status' },
  { key: 'fee', label: 'Plan Fee' },
  { key: 'platformFee', label: 'Platform Fee (12%)' },
  { key: 'payout', label: 'Your Payout' },
  { key: 'status', label: 'Status' },
  { key: 'action', label: 'Action' },
]

const clients = [
  { id: 'c1', name: 'Maria Rivera', plan: 'Gold', filing: 'MFJ', fee: '$504', platformFee: '$60.48', payout: '$443.52', status: 'Active' },
  { id: 'c2', name: 'David Chen', plan: 'Silver', filing: 'Single', fee: '$325', platformFee: '$39.00', payout: '$286.00', status: 'Active' },
  { id: 'c3', name: 'Sofia Martinez', plan: 'Bronze', filing: 'Single', fee: '$275', platformFee: '$33.00', payout: '$242.00', status: 'Pending' },
  { id: 'c4', name: 'Robert Thompson', plan: 'Gold', filing: 'MFJ', fee: '$504', platformFee: '$60.48', payout: '$443.52', status: 'Active' },
  { id: 'c5', name: 'Arjun Patel', plan: 'Snapshot', filing: 'Single', fee: '$425', platformFee: '$51.00', payout: '$374.00', status: 'Completed' },
  { id: 'c6', name: 'Linda Park', plan: 'Bronze', filing: 'Single', fee: '$275', platformFee: '$33.00', payout: '$242.00', status: 'Pending' },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function ClientPoolPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Client Pool</h1>
        <p className="mt-1 text-sm text-white/50">
          IRS transcript monitoring engagements available for you to service.
        </p>
      </div>

      {/* Info hero card */}
      <HeroCard>
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          <div>
            <h2 className="text-lg font-semibold text-white">Monitoring Service Plans</h2>
            <p className="mt-1 text-sm text-white/60">
              IRS transcript monitoring engagements. One-time service fee. Add MFJ (+$79) for a second spouse.
            </p>
          </div>
        </div>
      </HeroCard>

      {/* Service Plans grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {servicePlans.map((plan) => (
          <div
            key={plan.name}
            className="flex flex-col rounded-xl border border-[--member-border] bg-[--member-card] p-5"
          >
            <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
            <p className="mt-1 text-2xl font-bold text-brand-orange">{plan.price}</p>
            <p className="mt-0.5 text-xs text-white/40">{plan.duration}</p>
            <p className="mt-3 flex-1 text-sm text-white/50">{plan.description}</p>
            <p className="mt-3 text-xs text-white/30">{plan.mfj}</p>
            <button className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white shadow transition hover:opacity-90">
              Start monitoring
            </button>
          </div>
        ))}
      </div>

      {/* Available Clients table */}
      <div>
        <div className="mb-4">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Available Clients</h3>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[--member-border] bg-[--member-card]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[--member-border]">
                {columns.map((col) => (
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
              {clients.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[--member-border] last:border-b-0 transition hover:bg-[--member-card-hover]"
                >
                  <td className="px-5 py-3.5 font-medium text-white">{c.name}</td>
                  <td className="px-5 py-3.5 text-white/70">{c.plan}</td>
                  <td className="px-5 py-3.5 text-white/70">{c.filing}</td>
                  <td className="px-5 py-3.5 text-white/70">{c.fee}</td>
                  <td className="px-5 py-3.5 text-white/70">{c.platformFee}</td>
                  <td className="px-5 py-3.5 font-medium text-brand-orange">{c.payout}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={c.status} /></td>
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/client-pool/${c.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-orange/30 px-3 py-1.5 text-xs font-medium text-brand-orange transition hover:bg-brand-orange/10"
                    >
                      Service Client
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
