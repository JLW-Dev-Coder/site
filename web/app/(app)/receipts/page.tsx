import type { Metadata } from 'next'
import Card from '@/components/ui/Card'
import { getReceiptsByAccount } from '@/lib/api/client'
import { getSession } from '@/lib/auth/session'

export const metadata: Metadata = { title: 'Payments' }

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
    amount / 100,
  )
}

export default async function ReceiptsPage() {
  const session = await getSession()
  const receipts = await getReceiptsByAccount(session.account_id)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Payments</h1>
        <p className="mt-1 text-sm text-slate-400">Your billing history and downloadable invoices.</p>
      </div>

      <Card>
        {receipts.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">No receipts found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-3 pr-6">Date</th>
                  <th className="pb-3 pr-6">Invoice</th>
                  <th className="pb-3 pr-6">Amount</th>
                  <th className="pb-3 pr-6">Status</th>
                  <th className="pb-3">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {receipts.map((r) => (
                  <tr key={r.invoiceId} className="align-middle">
                    <td className="py-3 pr-6 text-slate-300">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 pr-6 font-mono text-xs text-slate-400">{r.invoiceId}</td>
                    <td className="py-3 pr-6 text-white">{formatAmount(r.amount, r.currency)}</td>
                    <td className="py-3 pr-6">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                          r.status === 'paid'
                            ? 'bg-emerald-900/60 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3">
                      {r.receiptUrl ? (
                        <a
                          href={r.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-amber-400 hover:text-amber-300"
                        >
                          Download
                        </a>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
