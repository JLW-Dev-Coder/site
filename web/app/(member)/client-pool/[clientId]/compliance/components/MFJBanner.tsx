'use client'

import { Users, X } from 'lucide-react'

interface Props {
  scope: 'primary' | 'spouse'
  onScopeChange: (scope: 'primary' | 'spouse') => void
  onClose: () => void
}

export default function MFJBanner({ scope, onScopeChange, onClose }: Props) {
  return (
    <div className="sticky top-0 z-50 border-b border-purple-500/30 bg-purple-500/15 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-start justify-between gap-4 px-6 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-purple-500/30 bg-purple-500/20 text-purple-200">
            <Users className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="text-sm font-semibold text-white">Associated Records</div>
              <div className="text-xs text-purple-200/90">
                MFJ detected. Review spouse-linked items before finalizing.
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-purple-500/25 bg-[#0a0e27]/60 px-2.5 py-1 text-xs text-purple-100">
                Primary · Margaret Chen
              </span>
              <span className="rounded-md border border-purple-500/25 bg-[#0a0e27]/60 px-2.5 py-1 text-xs text-purple-100">
                Spouse · David Chen
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onScopeChange('primary')}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  scope === 'primary'
                    ? 'border-brand-orange bg-brand-orange/15 text-white'
                    : 'border-purple-500/25 bg-[#0a0e27]/40 text-white/80 hover:bg-[#0a0e27]/60'
                }`}
              >
                Primary
              </button>
              <button
                type="button"
                onClick={() => onScopeChange('spouse')}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  scope === 'spouse'
                    ? 'border-brand-orange bg-brand-orange/15 text-white'
                    : 'border-purple-500/25 bg-[#0a0e27]/40 text-white/80 hover:bg-[#0a0e27]/60'
                }`}
              >
                Spouse
              </button>
              <span className="text-xs text-purple-200/80">
                Scope: {scope === 'primary' ? 'Primary' : 'Spouse'}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss MFJ banner"
          className="shrink-0 rounded-md border border-purple-500/25 bg-[#0a0e27]/40 p-2 text-purple-100 transition-colors hover:bg-[#0a0e27]/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
