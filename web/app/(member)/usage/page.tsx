import type { Metadata } from 'next'
import UsageClient from './UsageClient'

export const metadata: Metadata = { title: 'Usage' }

export default function UsagePage() {
  return <UsageClient />
}
