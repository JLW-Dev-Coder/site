'use client'

import { useState, type ReactNode, type ComponentType } from 'react'
import { ChevronDown } from 'lucide-react'

interface Props {
  icon: ComponentType<{ className?: string }>
  title: string
  badge?: { label: string; tone?: 'orange' | 'red' | 'green' }
  defaultOpen?: boolean
  children: ReactNode
}

export default function AccordionSection({
  icon: Icon,
  title,
  badge,
  defaultOpen = true,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)

  const badgeTones: Record<string, string> = {
    orange: 'bg-brand-orange/20 text-brand-orange',
    red: 'bg-red-500/20 text-red-400',
    green: 'bg-green-500/20 text-green-400',
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left transition hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-white/40" />
          <span className="font-medium text-white">{title}</span>
          {badge ? (
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                badgeTones[badge.tone ?? 'orange']
              }`}
            >
              {badge.label}
            </span>
          ) : null}
        </div>
        <ChevronDown
          className={`h-5 w-5 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div className="border-t border-white/10 px-4 pb-4 pt-4">{children}</div>
      ) : null}
    </div>
  )
}
