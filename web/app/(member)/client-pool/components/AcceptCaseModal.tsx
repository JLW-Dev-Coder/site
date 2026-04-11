'use client'

import { useEffect, useState } from 'react'
import { X, Check, Loader2 } from 'lucide-react'

export interface AcceptCaseModalCase {
  id: string
  name: string
  plan: string
  filing: string
  fee: string
  payout: string
}

export type AcceptResult = { success: true } | { success: false; blocked: true }

interface AcceptCaseModalProps {
  open: boolean
  caseData: AcceptCaseModalCase | null
  onClose: () => void
  onConfirm: (caseId: string) => Promise<AcceptResult>
}

export default function AcceptCaseModal({ open, caseData, onClose, onConfirm }: AcceptCaseModalProps) {
  const [loading, setLoading] = useState(false)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (open) {
      setLoading(false)
      setBlocked(false)
    }
  }, [open])

  if (!open || !caseData) return null

  async function handleConfirm() {
    if (!caseData) return
    setLoading(true)
    const result = await onConfirm(caseData.id)
    if (!result.success && result.blocked) {
      setBlocked(true)
      setLoading(false)
      return
    }
    setLoading(false)
  }

  function handleOverlayClick() {
    if (loading) return
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="accept-case-title"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-[--member-border] bg-[#0f1330] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute right-4 top-4 text-white/40 transition hover:text-white/80 disabled:opacity-40"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 id="accept-case-title" className="pr-6 text-lg font-semibold text-white">
          Accept this case?
        </h2>

        <dl className="mt-5 space-y-2 rounded-lg border border-[--member-border] bg-white/[0.02] p-4 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-white/50">Client</dt>
            <dd className="font-medium text-white">{caseData.name}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-white/50">Service plan</dt>
            <dd className="text-white/80">{caseData.plan}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-white/50">Filing status</dt>
            <dd className="text-white/80">{caseData.filing}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-white/50">Plan fee</dt>
            <dd className="text-white/80">{caseData.fee}</dd>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-[--member-border] pt-2">
            <dt className="text-white/60">Your payout</dt>
            <dd className="font-semibold text-brand-orange">{caseData.payout}</dd>
          </div>
        </dl>

        <p className="mt-5 text-xs leading-relaxed text-white/50">
          You will be assigned as the servicing professional. This case will be removed from the available pool.
          You agree to complete the engagement per TMP service terms.
        </p>

        {blocked && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            This case has already been accepted by another professional.
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/[0.06] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || blocked}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white shadow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Accepting...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Accept Case
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
