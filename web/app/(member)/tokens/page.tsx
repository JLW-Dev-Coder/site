import type { Metadata } from 'next'
import {
  Coins,
  FileText,
  CalendarCheck,
  Wallet,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import KPICard from '../components/KPICard'

export const metadata: Metadata = { title: 'Tokens' }

/* ── placeholder data ──────────────────────────────────────────── */

const allocations = [
  { label: 'Reports Generated', value: '3', equiv: '$45 equivalent', icon: FileText },
  { label: 'Calendar Bookings', value: '2', equiv: '$30 equivalent', icon: CalendarCheck },
  { label: 'Remaining Balance', value: '42', equiv: '$630 equivalent', icon: Wallet },
]

const activityColumns = [
  { key: 'activity', label: 'Activity' },
  { key: 'type', label: 'Type' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'date', label: 'Date' },
  { key: 'balance', label: 'Balance', className: 'text-right' },
]

const activityRows = [
  {
    activity: 'Monthly plan allocation',
    type: 'Credit',
    tokens: { amount: '+5', credit: true },
    date: 'Apr 4, 2026',
    balance: '47',
  },
  {
    activity: 'IRS Transcript Analysis — Martinez LLC',
    type: 'Report',
    tokens: { amount: '-1', credit: false },
    date: 'Apr 8, 2026',
    balance: '46',
  },
  {
    activity: 'Initial Consultation — David Chen',
    type: 'Booking',
    tokens: { amount: '-1', credit: false },
    date: 'Apr 7, 2026',
    balance: '44',
  },
  {
    activity: 'Form 2848 POA — Chen & Associates',
    type: 'Report',
    tokens: { amount: '-1', credit: false },
    date: 'Apr 5, 2026',
    balance: '43',
  },
  {
    activity: 'Monthly plan allocation',
    type: 'Credit',
    tokens: { amount: '+5', credit: true },
    date: 'Mar 4, 2026',
    balance: '42',
  },
  {
    activity: 'Wage & Income Summary — Thompson Trust',
    type: 'Report',
    tokens: { amount: '-1', credit: false },
    date: 'Mar 2, 2026',
    balance: '37',
  },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function TokensPage() {
  const balance = 47
  const monthlyAllocation = 5
  const usedThisMonth = 3
  const usagePercent = Math.round((usedThisMonth / monthlyAllocation) * 100)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Tokens</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage your token balance and purchases.
        </p>
      </div>

      {/* Token Balance hero card */}
      <HeroCard>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-orange/70">Token Balance</p>
            <p className="mt-3 text-5xl font-bold text-white">{balance}</p>
            <p className="mt-2 text-sm text-white/50">
              Tokens replenish monthly with your subscription. Use them for
              transcript reports, calendar bookings, and premium tools.
            </p>
            <div className="mt-1 text-xs text-white/40">
              Next refresh: May 4, 2026 · +5 tokens
            </div>
          </div>
          <div className="shrink-0">
            <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90">
              <Plus className="h-4 w-4" />
              Refill Tokens
            </button>
          </div>
        </div>
      </HeroCard>

      {/* Allocation grid */}
      <div className="grid gap-4 sm:grid-cols-3">
        {allocations.map((a) => (
          <KPICard
            key={a.label}
            label={a.label}
            value={a.value}
            change={a.equiv}
            trend="neutral"
            icon={a.icon}
          />
        ))}
      </div>

      {/* Membership Token Summary */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Membership Token Summary</h3>
        <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/40">Current Plan</p>
            <p className="mt-1 text-lg font-semibold text-brand-orange">VLP Scale</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/40">Next Renewal</p>
            <p className="mt-1 text-lg font-semibold text-white">May 4, 2026</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/40">Tokens / Month</p>
            <p className="mt-1 text-lg font-semibold text-white">{monthlyAllocation}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/40">Used This Month</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {usedThisMonth} <span className="text-sm font-normal text-white/40">of {monthlyAllocation}</span>
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-xs text-white/40">
            <span>Monthly allocation used</span>
            <span>{usagePercent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-orange to-brand-amber transition-all"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Recent Token Activity */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Coins className="h-4 w-4 text-white/30" />
          <h3 className="text-xs uppercase tracking-widest text-white/40">Recent Token Activity</h3>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[--member-border] bg-[--member-card]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[--member-border]">
                {activityColumns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium ${col.className ?? ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activityRows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-[--member-border] last:border-b-0 transition hover:bg-[--member-card-hover]"
                >
                  <td className="px-5 py-3.5 font-medium text-white">{row.activity}</td>
                  <td className="px-5 py-3.5 text-white/50">{row.type}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center gap-1 font-medium ${
                      row.tokens.credit ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {row.tokens.credit
                        ? <ArrowUpRight className="h-3.5 w-3.5" />
                        : <ArrowDownRight className="h-3.5 w-3.5" />
                      }
                      {row.tokens.amount}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-white/50">{row.date}</td>
                  <td className="px-5 py-3.5 text-right text-white/70">{row.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
