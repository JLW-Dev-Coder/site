import type { Metadata } from 'next'
import PayoutsClient from './PayoutsClient'

export const metadata: Metadata = { title: 'Payouts' }

export default function PayoutsPage() {
  return <PayoutsClient />
}
