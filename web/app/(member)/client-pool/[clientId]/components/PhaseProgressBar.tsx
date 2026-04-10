'use client'

import { CheckCircle2, Circle, Lock } from 'lucide-react'

export type PhaseStatus = 'complete' | 'current' | 'locked'

interface Phase {
  number: number
  name: string
  status: PhaseStatus
}

interface PhaseProgressBarProps {
  phases: Phase[]
}

const statusStyles: Record<PhaseStatus, { pill: string; icon: typeof CheckCircle2; connector: string }> = {
  complete: {
    pill: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    icon: CheckCircle2,
    connector: 'bg-emerald-500',
  },
  current: {
    pill: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    icon: Circle,
    connector: 'bg-white/10',
  },
  locked: {
    pill: 'border-white/10 bg-white/5 text-white/30',
    icon: Lock,
    connector: 'bg-white/10',
  },
}

export default function PhaseProgressBar({ phases }: PhaseProgressBarProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {phases.map((phase, i) => {
        const s = statusStyles[phase.status]
        const Icon = s.icon
        return (
          <div key={phase.number} className="flex items-center gap-2">
            <div
              className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${s.pill}`}
            >
              <Icon className="h-4 w-4" />
              <span className="whitespace-nowrap">
                Phase {phase.number}: {phase.name}
              </span>
            </div>
            {i < phases.length - 1 && (
              <div className={`h-0.5 w-8 shrink-0 rounded-full ${s.connector}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
