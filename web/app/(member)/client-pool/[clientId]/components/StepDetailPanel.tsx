'use client'

import Link from 'next/link'
import { Clock, ExternalLink, FileText, Lock, Settings } from 'lucide-react'
import type { StepDef } from './StepCard'
import FormPreview from './FormPreview'
import OperatorChecklist from './OperatorChecklist'

export interface StepAction {
  label: string
  href?: string
  external?: boolean
  disabled?: boolean
  tone?: 'primary' | 'secondary'
}

export interface StepActionConfig {
  primary?: StepAction
  secondary?: StepAction
  /** Message shown instead of a button (e.g. "Coming soon"). */
  notice?: string
}

interface StepDetailPanelProps {
  step: StepDef | null
  action?: StepActionConfig
}

function defaultLabelForStep(step: StepDef): string {
  if (step.status === 'complete') {
    return step.kind === 'operator' ? 'View Report' : 'View Submission'
  }
  if (step.status === 'current') return 'Continue Form'
  return 'Open Form'
}

function ActionLink({
  action,
  tone,
}: {
  action: StepAction
  tone: 'primary' | 'secondary'
}) {
  const base =
    'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition'
  const classes =
    tone === 'primary'
      ? `${base} bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/20 hover:opacity-90`
      : `${base} border border-white/10 bg-white/5 text-white/80 hover:bg-white/10`

  if (action.disabled || !action.href) {
    return (
      <button type="button" disabled className={`${classes} cursor-not-allowed opacity-50`}>
        <ExternalLink className="h-4 w-4" />
        {action.label}
      </button>
    )
  }

  if (action.external) {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={classes}>
        <ExternalLink className="h-4 w-4" />
        {action.label}
      </a>
    )
  }

  return (
    <Link href={action.href} className={classes}>
      <ExternalLink className="h-4 w-4" />
      {action.label}
    </Link>
  )
}

function ActionArea({ step, action }: { step: StepDef; action?: StepActionConfig }) {
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

  if (action?.notice) {
    return (
      <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/40">
        {action.notice}
      </div>
    )
  }

  const primary: StepAction = action?.primary ?? {
    label: defaultLabelForStep(step),
    disabled: true,
  }

  if (step.status === 'complete' && !action?.primary) {
    const completeTone =
      step.kind === 'operator'
        ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
        : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
    return (
      <button
        type="button"
        disabled
        className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition ${completeTone} cursor-not-allowed opacity-70`}
      >
        <FileText className="h-4 w-4" />
        {primary.label}
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <ActionLink action={primary} tone="primary" />
      {action?.secondary && <ActionLink action={action.secondary} tone="secondary" />}
    </div>
  )
}

export default function StepDetailPanel({ step, action }: StepDetailPanelProps) {
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

      {/* Action area */}
      <ActionArea step={step} action={action} />

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
