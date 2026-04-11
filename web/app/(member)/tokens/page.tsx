import type { Metadata } from 'next'
import TokensClient from './TokensClient'

export const metadata: Metadata = { title: 'Tokens' }

export default function TokensPage() {
  return <TokensClient />
}
