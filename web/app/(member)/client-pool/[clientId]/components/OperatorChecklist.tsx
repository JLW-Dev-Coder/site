'use client'

import { CheckCircle2, Circle, Clock } from 'lucide-react'

interface ChecklistItem {
  label: string
  completed: boolean
}

interface OperatorChecklistProps {
  items: ChecklistItem[]
  estimate?: string
}

export default function OperatorChecklist({ items, estimate }: OperatorChecklistProps) {
  const done = items.filter((i) => i.completed).length

  return (
    <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-widest text-white/40">Processing Checklist</h4>
        <span className="text-xs text-white/30">
          {done}/{items.length} complete
        </span>
      </div>
      <ol className="space-y-2">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-2.5 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/5 text-[10px] font-medium text-white/30">
              {i + 1}
            </span>
            {item.completed ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-white/20" />
            )}
            <span className={item.completed ? 'text-white/50 line-through' : 'text-white/70'}>
              {item.label}
            </span>
          </li>
        ))}
      </ol>
      {estimate && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-purple-500/10 px-3 py-1.5 text-xs text-purple-400">
          <Clock className="h-3.5 w-3.5" />
          Estimated: {estimate}
        </div>
      )}
    </div>
  )
}
