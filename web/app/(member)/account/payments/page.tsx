import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Payments' }

export default function PaymentsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Payments</h1>
      <p className="mt-1 text-sm text-white/50">
        Billing history and payment methods.
      </p>
    </div>
  )
}
