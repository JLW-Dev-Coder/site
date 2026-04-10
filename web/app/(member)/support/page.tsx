import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Support' }

export default function SupportPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Support</h1>
      <p className="mt-1 text-sm text-white/50">
        Get help from our team.
      </p>
    </div>
  )
}
