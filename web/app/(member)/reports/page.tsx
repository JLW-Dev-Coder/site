import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Reports' }

export default function ReportsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Reports</h1>
      <p className="mt-1 text-sm text-white/50">
        Generated reports and insights.
      </p>
    </div>
  )
}
