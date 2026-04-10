import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Affiliate' }

export default function AffiliatePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Affiliate</h1>
      <p className="mt-1 text-sm text-white/50">
        Track referrals and commissions.
      </p>
    </div>
  )
}
