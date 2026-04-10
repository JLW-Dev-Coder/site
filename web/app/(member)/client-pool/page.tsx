import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Client Pool' }

export default function ClientPoolPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Client Pool</h1>
      <p className="mt-1 text-sm text-white/50">
        Manage your client relationships.
      </p>
    </div>
  )
}
