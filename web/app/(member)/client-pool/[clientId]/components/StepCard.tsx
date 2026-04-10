'use client'

import type { LucideIcon } from 'lucide-react'

export type StepStatus = 'complete' | 'current' | 'ready' | 'locked'
export type StepKind = 'form' | 'operator'

export interface StepDef {
  id: string
  name: string
  description: string
  icon: LucideIcon
  status: StepStatus
  kind: StepKind
  phase: number
  formFields?: { name: string; completed: boolean }[]
  checklist?: { label: string; completed: boolean }[]
  estimate?: string
  whatWeNeed?: string[]
  whatWeDo?: string[]
}

interface StepCardProps {
  step: StepDef
  selected: boolean
  onSelect: (step: StepDef) => void
}

const statusLabel: Record<StepStatus, string> = {
  complete: 'Complete',
  current: 'Current',
  ready: 'Ready',
  locked: 'Locked',
}

const statusPill: Record<StepStatus, string> = {
  complete: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  current: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  ready: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  locked: 'bg-white/5 text-white/30 border-white/10',
}

const cardBorder: Record<StepStatus, string> = {
  complete: 'border-emerald-500/20 hover:border-emerald-500/40',
  current: 'border-amber-500/30 hover:border-amber-500/50',
  ready: 'border-blue-500/20 hover:border-blue-500/40',
  locked: 'border-white/5',
}

export default function StepCard({ step, selected, onSelect }: StepCardProps) {
  const Icon = step.icon
  const isClickable = step.status !== 'locked'

  return (
    <button
      type="button"
      onClick={() => isClickable && onSelect(step)}
      disabled={!isClickable}
      className={`group relative w-full rounded-xl border bg-[--member-card] p-4 text-left transition ${
        cardBorder[step.status]
      } ${selected ? 'ring-2 ring-brand-orange/40' : ''} ${
        isClickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
      } ${step.status === 'current' ? 'shadow-[0_0_20px_rgba(245,158,11,0.08)]' : ''}`}
    >
      {/* Pulsing glow for current step */}
      {step.status === 'current' && (
        <span className="absolute -inset-px animate-pulse rounded-xl border border-amber-500/20" />
      )}

      <div className="relative flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            step.status === 'locked' ? 'bg-white/5' : 'bg-[--member-accent]'
          }`}
        >
          <Icon
            className={`h-4.5 w-4.5 ${
              step.status === 'locked' ? 'text-white/20' : 'text-brand-orange'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                statusPill[step.status]
              }`}
            >
              {statusLabel[step.status]}
            </span>
          </div>
          <p className={`mt-1.5 text-sm font-medium ${step.status === 'locked' ? 'text-white/30' : 'text-white'}`}>
            {step.name}
          </p>
          <p className={`mt-0.5 text-xs ${step.status === 'locked' ? 'text-white/15' : 'text-white/40'}`}>
            {step.description}
          </p>
        </div>
      </div>
    </button>
  )
}
