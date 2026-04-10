import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Inquiries' }

export default function InquiriesPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Inquiries</h1>
      <p className="mt-1 text-sm text-white/50">
        Messages from prospective clients.
      </p>
    </div>
  )
}
