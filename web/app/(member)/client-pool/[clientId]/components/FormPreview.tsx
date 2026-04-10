'use client'

import { CheckCircle2, Circle } from 'lucide-react'

interface FormField {
  name: string
  completed: boolean
}

interface FormPreviewProps {
  fields: FormField[]
}

export default function FormPreview({ fields }: FormPreviewProps) {
  const done = fields.filter((f) => f.completed).length

  return (
    <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-widest text-white/40">Form Preview</h4>
        <span className="text-xs text-white/30">
          {done}/{fields.length} completed
        </span>
      </div>
      <ul className="space-y-2">
        {fields.map((field) => (
          <li key={field.name} className="flex items-center gap-2.5 text-sm">
            {field.completed ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-white/20" />
            )}
            <span className={field.completed ? 'text-white/50 line-through' : 'text-white/70'}>
              {field.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
