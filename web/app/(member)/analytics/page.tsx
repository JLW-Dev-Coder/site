import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Analytics' }

export default function AnalyticsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Analytics</h1>
      <p className="mt-1 text-sm text-white/50">
        Track performance across all platforms.
      </p>
    </div>
  )
}
