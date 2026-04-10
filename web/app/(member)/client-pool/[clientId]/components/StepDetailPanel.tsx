'use client'

import { Clock, ExternalLink, FileText, Lock, Settings } from 'lucide-react'
import type { StepDef } from './StepCard'
import FormPreview from './FormPreview'
import OperatorChecklist from './OperatorChecklist'

interface StepDetailPanelProps {
  step: StepDef | null
}

function ActionButton({ step }: { step: StepDef }) {
  if (step.status === 'locked') {
    return (
      <button
        type="button"
        disabled
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-3 text-sm font-medium text-white/30"
      >
        <Lock className="h-4 w-4" />
        Step Locked
      </button>
    )
  }

  if (step.status === 'complete') {
    if (step.kind === 'operator') {
      return (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-500/20 px-4 py-3 text-sm font-medium text-purple-400 transition hover:bg-purple-500/30"
        >
          <FileText className="h-4 w-4" />
          View Report
        </button>
      )
    }
    return (
      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500/20 px-4 py-3 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/30"
      >
        <FileText className="h-4 w-4" />
        View Submission
      </button>
    )
  }

  // current or ready
  const label = step.status === 'current' ? 'Continue Form' : 'Open Form'
  return (
    <button
      type="button"
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-amber-500/20 transition hover:opacity-90"
    >
      <ExternalLink className="h-4 w-4" />
      {label}
    </button>
  )
}

export default function StepDetailPanel({ step }: StepDetailPanelProps) {
  if (!step) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <p className="text-sm text-white/30">Select a step to view details</p>
      </div>
    )
  }

  const Icon = step.icon

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[--member-accent]">
            <Icon className="h-6 w-6 text-brand-orange" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-white">{step.name}</h3>
              {step.kind === 'operator' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-400 border border-purple-500/20">
                  <Settings className="h-3 w-3" />
                  Internal Processing
                </span>
              )}
            </div>
            <StatusPill status={step.status} />
          </div>
        </div>
      </div>

      {/* What This Step Does */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-5">
        <h4 className="mb-2 text-xs font-medium uppercase tracking-widest text-white/40">
          What This Step Does
        </h4>
        <p className="text-sm leading-relaxed text-white/60">{step.description}</p>
      </div>

      {/* Two-column info grid */}
      {(step.whatWeNeed?.length || step.whatWeDo?.length) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {step.whatWeNeed && step.whatWeNeed.length > 0 && (
            <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-4">
              <h4 className="mb-2.5 text-xs font-medium uppercase tracking-widest text-amber-400">
                What We Need From You
              </h4>
              <ul className="space-y-1.5">
                {step.whatWeNeed.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-white/60">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {step.whatWeDo && step.whatWeDo.length > 0 && (
            <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4">
              <h4 className="mb-2.5 text-xs font-medium uppercase tracking-widest text-emerald-400">
                What We Do
              </h4>
              <ul className="space-y-1.5">
                {step.whatWeDo.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-white/60">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Form Preview or Operator Checklist */}
      {step.kind === 'form' && step.formFields && step.formFields.length > 0 && (
        <FormPreview fields={step.formFields} />
      )}
      {step.kind === 'operator' && step.checklist && step.checklist.length > 0 && (
        <OperatorChecklist items={step.checklist} estimate={step.estimate} />
      )}

      {/* Action button */}
      <ActionButton step={step} />

      {/* Secondary links */}
      {step.status !== 'locked' && (
        <div className="flex items-center gap-4 text-xs">
          <button type="button" className="flex items-center gap-1 text-white/30 transition hover:text-white/50">
            <Clock className="h-3.5 w-3.5" />
            View Timeline
          </button>
          <button type="button" className="flex items-center gap-1 text-white/30 transition hover:text-white/50">
            <FileText className="h-3.5 w-3.5" />
            View Files
          </button>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: StepDef['status'] }) {
  const map: Record<string, string> = {
    complete: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    current: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    ready: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    locked: 'bg-white/5 text-white/30 border-white/10',
  }
  const label: Record<string, string> = { complete: 'Complete', current: 'In Progress', ready: 'Ready', locked: 'Locked' }
  return (
    <span className={`mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${map[status]}`}>
      {label[status]}
    </span>
  )
}
