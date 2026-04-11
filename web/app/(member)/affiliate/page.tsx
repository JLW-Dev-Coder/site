import type { Metadata } from 'next'
import AffiliateClient from './AffiliateClient'

export const metadata: Metadata = { title: 'Affiliate' }

export default function AffiliatePage() {
  return <AffiliateClient />
}
