'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import AcceptCaseModal, { type AcceptResult } from './components/AcceptCaseModal'
import {
  acceptClientPoolCase,
  getClientPoolCases,
  type CasePoolRecord,
} from '@/lib/api/client-pool'
import { getDashboard } from '@/lib/api/dashboard'

type DisplayStatus = 'Available' | 'Assigned' | 'In Progress' | 'Completed' | 'Paid Out'
type TabKey = 'available' | 'mine' | 'completed'

interface PoolCase {
  id: string
  name: string
  plan: string
  filing: string
  fee: string
  platformFee: string
  payout: string
  status: DisplayStatus
  acceptedAt?: string
}

const STATUS_LABELS: Record<string, DisplayStatus> = {
  available: 'Available',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
  paid_out: 'Paid Out',
}

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

function formatMoneyCents(cents: number | undefined | null): string | null {
  if (cents == null || Number.isNaN(cents)) return null
  return `$${(cents / 100).toFixed(2)}`
}

function formatMoneyDollars(dollars: number | undefined | null): string | null {
  if (dollars == null || Number.isNaN(dollars)) return null
  return `$${dollars.toFixed(2)}`
}

function adaptCase(record: CasePoolRecord): PoolCase {
  const name = String(record.taxpayer_name ?? record.client_name ?? 'Unnamed client')
  const plan = String(record.service_plan ?? record.plan ?? '—')
  const filing = String(record.filing_status ?? record.filing ?? '—')

  const feeCents =
    typeof record.service_fee_cents === 'number'
      ? record.service_fee_cents
      : typeof record.plan_fee_cents === 'number'
      ? record.plan_fee_cents
      : typeof record.service_fee === 'number'
      ? Math.round(record.service_fee * 100)
      : null

  const platformFeeCents =
    typeof record.platform_fee_cents === 'number'
      ? record.platform_fee_cents
      : feeCents != null
      ? Math.round(feeCents * 0.12)
      : null

  const payoutCents =
    typeof record.payout_cents === 'number'
      ? record.payout_cents
      : feeCents != null && platformFeeCents != null
      ? feeCents - platformFeeCents
      : null

  const fee = formatMoneyCents(feeCents) ?? formatMoneyDollars(record.service_fee as number) ?? '—'
  const platformFee = formatMoneyCents(platformFeeCents) ?? '—'
  const payout = formatMoneyCents(payoutCents) ?? '—'

  const rawStatus = String(record.status ?? 'available').toLowerCase()
  const status = STATUS_LABELS[rawStatus] ?? 'Available'

  return {
    id: record.case_id,
    name,
    plan,
    filing,
    fee,
    platformFee,
    payout,
    status,
    acceptedAt: record.assigned_at ?? undefined,
  }
}

interface TabState {
  loading: boolean
  error: string | null
  cases: PoolCase[]
  loaded: boolean
}

const initialTabState: TabState = { loading: false, error: null, cases: [], loaded: false }

interface ToastState {
  id: number
  kind: 'success' | 'error'
  message: string
}

export default function ClientPoolTable() {
  const [activeTab, setActiveTab] = useState<TabKey>('available')
  const [professionalId, setProfessionalId] = useState<string | null>(null)
  const [profError, setProfError] = useState<string | null>(null)
  const [tabs, setTabs] = useState<Record<TabKey, TabState>>({
    available: initialTabState,
    mine: initialTabState,
    completed: initialTabState,
  })
  const [modalCase, setModalCase] = useState<PoolCase | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  function showToast(kind: ToastState['kind'], message: string) {
    const id = Date.now()
    setToast({ id, kind, message })
    setTimeout(() => {
      setToast((current) => (current && current.id === id ? null : current))
    }, 4000)
  }

  const loadTab = useCallback(
    async (tab: TabKey, proId: string | null) => {
      setTabs((prev) => ({ ...prev, [tab]: { ...prev[tab], loading: true, error: null } }))
      try {
        let response
        if (tab === 'available') {
          response = await getClientPoolCases({ status: 'available', limit: 100 })
        } else if (tab === 'mine') {
          if (!proId) {
            setTabs((prev) => ({
              ...prev,
              mine: { loading: false, error: null, cases: [], loaded: true },
            }))
            return
          }
          response = await getClientPoolCases({
            professional_id: proId,
            status: 'assigned,in_progress',
            limit: 100,
          })
        } else {
          if (!proId) {
            setTabs((prev) => ({
              ...prev,
              completed: { loading: false, error: null, cases: [], loaded: true },
            }))
            return
          }
          response = await getClientPoolCases({
            professional_id: proId,
            status: 'completed,paid_out',
            limit: 100,
          })
        }
        const mapped = (response.cases ?? []).map(adaptCase)
        setTabs((prev) => ({
          ...prev,
          [tab]: { loading: false, error: null, cases: mapped, loaded: true },
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setTabs((prev) => ({
          ...prev,
          [tab]: { loading: false, error: message, cases: [], loaded: true },
        }))
      }
    },
    []
  )

  // Initial load: resolve professional_id from dashboard, then fetch Available
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dashboard = await getDashboard()
        if (cancelled) return
        setProfessionalId(dashboard.account.professional_id ?? null)
      } catch (err) {
        if (cancelled) return
        setProfError(err instanceof Error ? err.message : 'Could not load profile')
      } finally {
        if (!cancelled) {
          loadTab('available', null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadTab])

  // Lazy-load each non-available tab the first time it is shown
  useEffect(() => {
    if (activeTab === 'available') return
    if (tabs[activeTab].loaded || tabs[activeTab].loading) return
    loadTab(activeTab, professionalId)
  }, [activeTab, professionalId, tabs, loadTab])

  async function handleAccept(caseId: string): Promise<AcceptResult> {
    const target = tabs.available.cases.find((c) => c.id === caseId)
    const clientName = target?.name ?? 'this client'

    try {
      const data = await acceptClientPoolCase(caseId)
      if (data.ok) {
        // Optimistically remove from the Available list and invalidate My Cases
        setTabs((prev) => ({
          ...prev,
          available: {
            ...prev.available,
            cases: prev.available.cases.filter((c) => c.id !== caseId),
          },
          mine: { ...prev.mine, loaded: false },
        }))
        setModalCase(null)
        setActiveTab('mine')
        showToast('success', `Case accepted. You are now assigned to ${clientName}.`)
        return { success: true }
      }
      if (data.error === 'case_not_available') {
        return { success: false, blocked: true }
      }
      showToast('error', data.message ?? data.error ?? 'Could not accept case.')
      return { success: false, blocked: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error'
      showToast('error', `Could not accept case (${message}).`)
      return { success: false, blocked: true }
    }
  }

  const tabMeta: { key: TabKey; label: string; count: number | null }[] = [
    { key: 'available', label: 'Available', count: tabs.available.loaded ? tabs.available.cases.length : null },
    { key: 'mine', label: 'My Cases', count: tabs.mine.loaded ? tabs.mine.cases.length : null },
    { key: 'completed', label: 'Completed', count: tabs.completed.loaded ? tabs.completed.cases.length : null },
  ]

  const current = tabs[activeTab]
  const columns = activeTab === 'available' ? availableColumns : assignedColumns

  const emptyMessage =
    activeTab === 'available'
      ? 'No cases available right now. Check back soon.'
      : activeTab === 'mine'
      ? 'No assigned cases yet. Accept a case from the Available tab.'
      : 'No completed cases yet.'

  return (
    <div>
      {/* Profile-resolution warning — only shown if My Cases tab needs a pro ID */}
      {profError && activeTab !== 'available' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Could not load your profile. Some tabs may be empty.</span>
        </div>
      )}

      {/* Tab bar */}
      <div className="mb-4 inline-flex gap-1 rounded-xl border border-[--member-border] bg-[--member-card] p-1">
        {tabMeta.map((t) => {
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
                {t.count ?? '—'}
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
            {current.loading ? (
              <>
                {[0, 1, 2].map((row) => (
                  <tr key={`skeleton-${row}`} className="border-b border-[--member-border] last:border-b-0">
                    {columns.map((col) => (
                      <td key={col.key} className="px-5 py-4">
                        <div className="h-3 w-full max-w-[140px] animate-pulse rounded bg-white/5" />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-5 py-4 text-center text-xs text-white/40"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading cases…
                    </span>
                  </td>
                </tr>
              </>
            ) : current.error ? (
              <tr>
                <td colSpan={columns.length} className="px-5 py-10 text-center text-sm text-red-300">
                  Could not load cases. Please try again.
                </td>
              </tr>
            ) : current.cases.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-5 py-10 text-center text-sm text-white/40">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              current.cases.map((c) => (
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
