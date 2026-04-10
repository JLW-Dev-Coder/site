import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Usage' }

export default function UsagePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Usage</h1>
      <p className="mt-1 text-sm text-white/50">
        Detailed breakdown of your resource consumption.
      </p>
    </div>
  )
}
