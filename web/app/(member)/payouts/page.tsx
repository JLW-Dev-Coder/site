import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Payouts' }

export default function PayoutsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Payouts</h1>
      <p className="mt-1 text-sm text-white/50">
        View earnings and payout history.
      </p>
    </div>
  )
}
