import type { Metadata } from 'next'
import { getSession } from '@/lib/auth/session'
import { getAffiliate, getAffiliateEvents } from '@/lib/api/client'
import AffiliateClient from './AffiliateClient'

export const metadata: Metadata = { title: 'Affiliate Program' }

export default async function AffiliatePage() {
  const session = await getSession()

  const [affiliateData, affiliateEvents] = await Promise.all([
    getAffiliate(session.account_id),
    getAffiliateEvents(session.account_id),
  ])

  return (
    <AffiliateClient
      accountId={session.account_id}
      initialAffiliateData={affiliateData}
      initialAffiliateEvents={affiliateEvents}
    />
  )
}