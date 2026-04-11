'use client'

import { useEffect, useState } from 'react'
import {
  Plus,
  BookOpen,
  CircleDot,
  Clock,
  CheckCircle2,
  Headphones,
  Phone,
  AlertCircle,
} from 'lucide-react'
import KPICard from '../components/KPICard'
import StatusBadge from '../components/StatusBadge'
import DataTable from '../components/DataTable'
import HeroCard from '../components/HeroCard'
import { getDashboard } from '@/lib/api/dashboard'
import { getSupportTicketsByAccount, type SupportTicketRow } from '@/lib/api/member'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tickets: SupportTicketRow[] }

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function statusLabel(s: string): string {
  const v = (s || '').toLowerCase()
  if (v === 'open' || v === 'reopened') return 'active'
  if (v === 'in_progress' || v === 'awaiting') return 'pending'
  if (v === 'resolved' || v === 'closed') return 'resolved'
  return s || 'active'
}

export default function SupportClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dashboard = await getDashboard()
        if (cancelled) return
        const tickets = await getSupportTicketsByAccount(dashboard.account.account_id).catch(
          () => [] as SupportTicketRow[]
        )
        if (!cancelled) setState({ status: 'ready', tickets })
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not load tickets',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') return <SupportSkeleton />
  if (state.status === 'error') return <SupportFallback message={state.message} />

  const { tickets } = state

  const openCount = tickets.filter((t) => {
    const s = (t.status ?? '').toLowerCase()
    return s === 'open' || s === 'reopened'
  }).length
  const pendingCount = tickets.filter((t) => {
    const s = (t.status ?? '').toLowerCase()
    return s === 'in_progress' || s === 'awaiting'
  }).length
  const resolvedCount = tickets.filter((t) => {
    const s = (t.status ?? '').toLowerCase()
    return s === 'resolved' || s === 'closed'
  }).length

  const kpis = [
    {
      label: 'Open',
      value: String(openCount),
      icon: CircleDot,
      change: openCount === 0 ? 'None open' : 'Needs attention',
      trend: 'neutral' as const,
    },
    {
      label: 'Pending',
      value: String(pendingCount),
      icon: Clock,
      change: 'Awaiting response',
      trend: 'neutral' as const,
    },
    {
      label: 'Resolved',
      value: String(resolvedCount),
      icon: CheckCircle2,
      change: 'All time',
      trend: 'neutral' as const,
    },
  ]

  const rows = tickets.slice(0, 25).map((t) => ({
    subject: (
      <span className="font-medium text-brand-orange hover:text-brand-amber transition">
        {t.subject || '(no subject)'}
      </span>
    ),
    category: t.category ?? (t.priority ? t.priority : 'General'),
    status: <StatusBadge status={statusLabel(t.status)} />,
    created: formatDate(t.created_at),
    updated: formatDate(t.updated_at),
  }))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Support</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage support tickets and get help.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href="/support/create"
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Create New Ticket
        </a>
        <a
          href="/help"
          className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-5 py-2.5 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10"
        >
          <BookOpen className="h-4 w-4" />
          View Help Docs
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {kpis.map((t) => (
          <KPICard key={t.label} {...t} />
        ))}
      </div>

      <div>
        {rows.length === 0 ? (
          <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-10 text-center">
            <p className="text-sm text-white/40">No support tickets yet.</p>
            <a
              href="/support/create"
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-brand-orange hover:text-brand-amber transition"
            >
              <Plus className="h-4 w-4" />
              Create your first ticket
            </a>
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'subject', label: 'Subject' },
              { key: 'category', label: 'Category' },
              { key: 'status', label: 'Status' },
              { key: 'created', label: 'Created' },
              { key: 'updated', label: 'Last Update' },
            ]}
            rows={rows}
          />
        )}
      </div>

      <HeroCard>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-orange/20">
              <Headphones className="h-6 w-6 text-brand-orange" />
            </div>
            <div>
              <p className="text-lg font-semibold text-white">Need Immediate Assistance?</p>
              <p className="mt-1 text-sm text-white/50">
                Our support team typically responds within 2–4 hours during business hours (Mon–Fri, 9am–5pm PT).
              </p>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-white/40">
                <Phone className="h-3 w-3" />
                Phone support available for Premier members
              </div>
            </div>
          </div>
        </div>
      </HeroCard>
    </div>
  )
}

function SupportSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Support</h1>
        <p className="mt-1 text-sm text-white/50">Loading tickets…</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
    </div>
  )
}

function SupportFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Support</h1>
        <p className="mt-1 text-sm text-white/50">Manage support tickets and get help.</p>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Could not load live data</p>
          <p className="mt-1 text-amber-200/70">{message}</p>
        </div>
      </div>
    </div>
  )
}
