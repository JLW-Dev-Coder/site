'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { RecordStatus } from '../types'

interface Props {
  clientId: string
  clientName: string
  orderId: string
  status: RecordStatus
  lastSavedLabel: string
  onSaveDraft: () => void
  onFinalize: () => void
  saving: boolean
  finalized: boolean
  mfjOffset: boolean
}

export default function ComplianceHeader({
  clientId,
  clientName,
  orderId,
  status,
  lastSavedLabel,
  onSaveDraft,
  onFinalize,
  saving,
  finalized,
  mfjOffset,
}: Props) {
  const badgeTone =
    status === 'Final'
      ? 'bg-green-500/20 text-green-400 border-green-500/30'
      : 'bg-amber-500/20 text-amber-400 border-amber-500/30'

  return (
    <header
      className="sticky z-40 border-b border-white/10 bg-[#0a0e27]/90 px-6 py-4 backdrop-blur"
      style={{ top: mfjOffset ? '92px' : '0px' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href={`/client-pool/${clientId}`}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-brand-orange transition hover:text-brand-amber"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Client Record
          </Link>

          <div className="flex items-center gap-5 border-l border-white/10 pl-6">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                Client
              </p>
              <p className="text-sm font-medium text-white">{clientName}</p>
            </div>
            <div className="hidden sm:block">
              <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                ID
              </p>
              <p className="font-mono text-sm text-white/70">{clientId}</p>
            </div>
            <div className="hidden lg:block">
              <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                Order
              </p>
              <p className="font-mono text-sm text-white/70">{orderId}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium ${badgeTone}`}
            >
              {status.toUpperCase()}
            </span>
            <span className="hidden text-xs text-white/40 sm:inline">
              Last saved: <span className="text-white/60">{lastSavedLabel}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 border-l border-white/10 pl-4">
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={saving || finalized}
              className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              type="button"
              onClick={onFinalize}
              disabled={finalized}
              className="rounded-md bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {finalized ? 'Finalized' : 'Finalize Record'}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
