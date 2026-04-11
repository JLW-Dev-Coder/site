'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import AcceptCaseModal, { type AcceptResult } from './components/AcceptCaseModal'

type CaseStatus = 'Available' | 'Assigned' | 'In Progress' | 'Completed' | 'Paid Out'
type TabKey = 'available' | 'mine' | 'completed'

interface PoolCase {
  id: string
  name: string
  plan: string
  filing: string
  fee: string
  platformFee: string
  payout: string
  status: CaseStatus
  acceptedAt?: string
}

const initialCases: PoolCase[] = [
  { id: 'c1', name: 'Maria Rivera', plan: 'Gold', filing: 'MFJ', fee: '$504', platformFee: '$60.48', payout: '$443.52', status: 'Available' },
  { id: 'c2', name: 'David Chen', plan: 'Silver', filing: 'Single', fee: '$325', platformFee: '$39.00', payout: '$286.00', status: 'Available' },
  { id: 'c3', name: 'Sofia Martinez', plan: 'Bronze', filing: 'Single', fee: '$275', platformFee: '$33.00', payout: '$242.00', status: 'Available' },
  { id: 'c4', name: 'Robert Thompson', plan: 'Gold', filing: 'MFJ', fee: '$504', platformFee: '$60.48', payout: '$443.52', status: 'Available' },
  { id: 'c5', name: 'Arjun Patel', plan: 'Snapshot', filing: 'Single', fee: '$425', platformFee: '$51.00', payout: '$374.00', status: 'Available' },
  { id: 'c6', name: 'Linda Park', plan: 'Bronze', filing: 'Single', fee: '$275', platformFee: '$33.00', payout: '$242.00', status: 'Available' },
]

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

const availableColumns = [
  { key: 'client', label: 'Client Name' },
  { key: 'plan', label: 'Service Plan' },
  { key: 'filing', label: 'Filing Status' },
  { key: 'fee', label: 'Plan Fee' },
  { key: 'platformFee', label: 'Platform Fee (12%)' },
  { key: 'payout', label: 'Your Payout' },
  { key: 'status', label: 'Status' },
  { key: 'action', label: 'Action' },
]

const assignedColumns = [
  { key: 'client', label: 'Client Name' },
  { key: 'plan', label: 'Service Plan' },
  { key: 'filing', label: 'Filing Status' },
  { key: 'fee', label: 'Plan Fee' },
  { key: 'payout', label: 'Your Payout' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'status', label: 'Status' },
  { key: 'action', label: 'Action' },
]

function formatDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface ToastState {
  id: number
  kind: 'success' | 'error'
  message: string
}

export default function ClientPoolTable() {
  const [cases, setCases] = useState<PoolCase[]>(initialCases)
  const [activeTab, setActiveTab] = useState<TabKey>('available')
  const [modalCase, setModalCase] = useState<PoolCase | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const availableCases = cases.filter((c) => c.status === 'Available')
  const myCases = cases.filter((c) => c.status === 'Assigned' || c.status === 'In Progress')
  const completedCases = cases.filter((c) => c.status === 'Completed' || c.status === 'Paid Out')

  function showToast(kind: ToastState['kind'], message: string) {
    const id = Date.now()
    setToast({ id, kind, message })
    setTimeout(() => {
      setToast((current) => (current && current.id === id ? null : current))
    }, 4000)
  }

  function acceptLocally(caseId: string) {
    const now = new Date().toISOString()
    setCases((prev) =>
      prev.map((c) => (c.id === caseId ? { ...c, status: 'Assigned' as CaseStatus, acceptedAt: now } : c))
    )
    setActiveTab('mine')
  }

  async function handleAccept(caseId: string): Promise<AcceptResult> {
    const target = cases.find((c) => c.id === caseId)
    const clientName = target?.name ?? 'this client'

    let apiErrorReason: string | null = null

    try {
      const res = await fetch(`${API_URL}/v1/tmp/client-pool/accept`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: caseId,
          professional_id: 'resolved_server_side',
        }),
      })

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }

      if (res.ok && data.ok) {
        acceptLocally(caseId)
        setModalCase(null)
        showToast('success', `Case accepted. You are now assigned to ${clientName}.`)
        return { success: true }
      }

      if (data.error === 'case_not_available') {
        return { success: false, blocked: true }
      }

      apiErrorReason = data.error || `HTTP ${res.status}`
    } catch (err) {
      apiErrorReason = err instanceof Error ? err.message : 'network error'
    }

    acceptLocally(caseId)
    setModalCase(null)
    showToast('error', `API unavailable (${apiErrorReason}). Accepted locally as fallback.`)
    return { success: true }
  }

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'available', label: 'Available', count: availableCases.length },
    { key: 'mine', label: 'My Cases', count: myCases.length },
    { key: 'completed', label: 'Completed', count: completedCases.length },
  ]

  let visibleCases: PoolCase[]
  let columns
  if (activeTab === 'available') {
    visibleCases = availableCases
    columns = availableColumns
  } else if (activeTab === 'mine') {
    visibleCases = myCases
    columns = assignedColumns
  } else {
    visibleCases = completedCases
    columns = assignedColumns
  }

  const emptyMessage =
    activeTab === 'available'
      ? 'No cases available right now. Check back soon.'
      : activeTab === 'mine'
      ? 'No active cases yet. Accept a case from the Available tab.'
      : 'No completed cases yet.'

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-4 inline-flex gap-1 rounded-xl border border-[--member-border] bg-[--member-card] p-1">
        {tabs.map((t) => {
          const isActive = t.key === activeTab
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                isActive ? 'bg-brand-orange/10 text-brand-orange' : 'text-white/60 hover:text-white/90'
              }`}
            >
              {t.label}
              <span
                className={`inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  isActive ? 'bg-brand-orange/20 text-brand-orange' : 'bg-white/10 text-white/60'
                }`}
              >
                {t.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[--member-border] bg-[--member-card]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[--member-border]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-5 py-3 text-[11px] font-medium uppercase tracking-widest text-white/40"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleCases.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-5 py-10 text-center text-sm text-white/40">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visibleCases.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[--member-border] transition last:border-b-0 hover:bg-[--member-card-hover]"
                >
                  <td className="px-5 py-3.5 font-medium text-white">{c.name}</td>
                  <td className="px-5 py-3.5 text-white/70">{c.plan}</td>
                  <td className="px-5 py-3.5 text-white/70">{c.filing}</td>
                  <td className="px-5 py-3.5 text-white/70">{c.fee}</td>
                  {activeTab === 'available' && (
                    <td className="px-5 py-3.5 text-white/70">{c.platformFee}</td>
                  )}
                  <td className="px-5 py-3.5 font-medium text-brand-orange">{c.payout}</td>
                  {activeTab !== 'available' && (
                    <td className="px-5 py-3.5 text-white/60">{formatDate(c.acceptedAt)}</td>
                  )}
                  <td className="px-5 py-3.5">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-5 py-3.5">
                    {activeTab === 'available' ? (
                      <button
                        type="button"
                        onClick={() => setModalCase(c)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-orange/30 px-3 py-1.5 text-xs font-medium text-brand-orange transition hover:bg-brand-orange/10"
                      >
                        Service Client
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    ) : (
                      <Link
                        href={`/client-pool/${c.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-brand-orange/40 hover:text-brand-orange"
                      >
                        View Case
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <AcceptCaseModal
        open={modalCase !== null}
        caseData={
          modalCase
            ? {
                id: modalCase.id,
                name: modalCase.name,
                plan: modalCase.plan,
                filing: modalCase.filing,
                fee: modalCase.fee,
                payout: modalCase.payout,
              }
            : null
        }
        onClose={() => setModalCase(null)}
        onConfirm={handleAccept}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-[--member-border] bg-[#0f1330] px-4 py-3 shadow-2xl">
          {toast.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          )}
          <p className="text-sm text-white/90">{toast.message}</p>
        </div>
      )}
    </div>
  )
}
