import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata: Metadata = { title: 'Client Record' }

export default function ClientRecordPage() {
  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/client-pool"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-brand-orange transition hover:text-brand-amber"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Client Pool
        </Link>
        <h1 className="text-2xl font-semibold text-white">Client Record</h1>
        <p className="mt-1 text-sm text-white/50">Coming Soon</p>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-xl border border-[--member-border] bg-[--member-card] py-16 text-center">
        <p className="text-lg font-medium text-white/60">
          Client Record details will be available in Phase C.
        </p>
        <p className="text-sm text-white/40">
          This page will include engagement details, transcript pulls, timeline, and client communications.
        </p>
      </div>
    </div>
  )
}
