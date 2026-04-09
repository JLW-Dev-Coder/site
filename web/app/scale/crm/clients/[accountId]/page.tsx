'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Card from '@/components/ui/Card'

interface Account {
  id: string
  account_id: string
  email: string
  name: string
  platform: string
  status: string
  created_at: string
  updated_at?: string
}

interface Membership {
  membership_id: string
  plan_key: string
  billing_interval?: string
  status: string
  created_at: string
  updated_at?: string
}

interface Tokens {
  transcript_total: number
  tax_game_total: number
  updated_at?: string | null
}

interface Ticket {
  id: string
  ticket_id: string
  subject: string
  priority: string
  status: string
  created_at: string
  updated_at?: string
}

interface Payment {
  id: string
  amount: number
  currency: string
  status: string
  description?: string
  email?: string
  customer?: string
  created: number
  platform: string
}

interface DetailResponse {
  ok: boolean
  account?: Account
  memberships?: Membership[]
  tokens?: Tokens
  tickets?: Ticket[]
  payments?: Payment[]
  error?: string
}

function fmtMoney(amount: number, currency: string) {
  if (typeof amount !== 'number') return '—'
  const dollars = amount / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'USD').toUpperCase() }).format(dollars)
  } catch {
    return `$${dollars.toFixed(2)}`
  }
}

export default function ClientDetailPage() {
  const params = useParams<{ accountId: string }>()
  const accountId = params?.accountId
  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) return
    async function load() {
      try {
        const res = await fetch(`https://api.virtuallaunch.pro/v1/admin/accounts/${encodeURIComponent(accountId)}`, {
          credentials: 'include',
        })
        const body: DetailResponse = await res.json()
        if (!res.ok || !body.ok) {
          setError(body.error || `HTTP ${res.status}`)
        } else {
          setData(body)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load client')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [accountId])

  const account = data?.account
  const memberships = data?.memberships ?? []
  const tokens = data?.tokens
  const tickets = data?.tickets ?? []
  const payments = data?.payments ?? []
  const activeMembership = memberships.find((m) => m.status === 'active') || memberships[0]

  return (
    <div className="space-y-6">
      <div>
        <Link href="/scale/crm/clients" className="text-xs text-slate-400 hover:text-orange-400">← Back to Clients</Link>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          {loading ? 'Loading…' : account?.name || account?.email || 'Client'}
        </h1>
        {account?.email && (
          <p className="mt-1 text-sm text-slate-400">
            {account.email} · <span className="uppercase">{account.platform || '—'}</span>
            {account.created_at && ` · joined ${new Date(account.created_at).toLocaleDateString()}`}
          </p>
        )}
      </div>

      {error && (
        <Card>
          <div className="py-6 text-center text-sm text-rose-400">Error: {error}</div>
        </Card>
      )}

      {!error && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Membership</div>
              <div className="mt-2 text-lg font-bold text-white">
                {activeMembership ? activeMembership.plan_key : 'None'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {activeMembership ? `Status: ${activeMembership.status}` : 'No membership'}
              </div>
            </Card>
            <Card>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Token Balance</div>
              <div className="mt-2 text-lg font-bold text-white">
                {(tokens?.transcript_total ?? 0).toLocaleString()} transcript
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {(tokens?.tax_game_total ?? 0).toLocaleString()} game tokens
              </div>
            </Card>
            <Card>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</div>
              <div className="mt-2 text-lg font-bold text-white">{account?.status || '—'}</div>
              <div className="mt-1 text-xs text-slate-500">{account?.account_id || ''}</div>
            </Card>
          </div>

          <Card>
            <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Memberships ({memberships.length})
            </div>
            {memberships.length === 0 ? (
              <div className="py-4 text-center text-sm text-slate-500">No memberships on file.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2">Plan</th>
                      <th className="px-3 py-2">Interval</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberships.map((m) => (
                      <tr key={m.membership_id} className="border-b border-slate-800/60">
                        <td className="px-3 py-3 font-medium text-white">{m.plan_key}</td>
                        <td className="px-3 py-3 text-slate-400">{m.billing_interval || '—'}</td>
                        <td className="px-3 py-3 text-slate-300">{m.status}</td>
                        <td className="px-3 py-3 text-slate-400">{m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}</td>
                        <td className="px-3 py-3 text-slate-400">{m.updated_at ? new Date(m.updated_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Recent Payments ({payments.length})
            </div>
            {payments.length === 0 ? (
              <div className="py-4 text-center text-sm text-slate-500">No payment history found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2">Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-b border-slate-800/60">
                        <td className="px-3 py-3 text-slate-400">
                          {p.created ? new Date(p.created * 1000).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-3 py-3 font-medium text-white">{fmtMoney(p.amount, p.currency)}</td>
                        <td className="px-3 py-3 text-slate-300">{p.status}</td>
                        <td className="px-3 py-3 text-slate-400">{p.description || '—'}</td>
                        <td className="px-3 py-3 text-slate-500 uppercase">{p.platform}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Support Tickets ({tickets.length})
            </div>
            {tickets.length === 0 ? (
              <div className="py-4 text-center text-sm text-slate-500">No support tickets.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2">Subject</th>
                      <th className="px-3 py-2">Priority</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => (
                      <tr key={t.ticket_id} className="border-b border-slate-800/60">
                        <td className="px-3 py-3 font-medium text-white">{t.subject}</td>
                        <td className="px-3 py-3 text-slate-400">{t.priority}</td>
                        <td className="px-3 py-3 text-slate-300">{t.status}</td>
                        <td className="px-3 py-3 text-slate-400">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
