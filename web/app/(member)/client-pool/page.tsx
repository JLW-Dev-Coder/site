import type { Metadata } from 'next'
import { Info } from 'lucide-react'
import HeroCard from '../components/HeroCard'
import ClientPoolTable from './ClientPoolTable'

export const metadata: Metadata = { title: 'Client Pool' }

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

      {/* Interactive client pool (tabs + table + accept modal) */}
      <ClientPoolTable />
    </div>
  )
}
