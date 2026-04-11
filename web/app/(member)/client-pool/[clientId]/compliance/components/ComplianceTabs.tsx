'use client'

import type { TabId } from '../types'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'agent', label: 'Agent' },
  { id: 'authority', label: 'Authority' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'notices', label: 'Notices' },
  { id: 'installment', label: 'Installment Agreement' },
  { id: 'revenue', label: 'Revenue Officer' },
  { id: 'transcripts', label: 'Transcripts' },
  { id: 'summary', label: 'Summary' },
]

interface Props {
  active: TabId
  onChange: (id: TabId) => void
  mfjOffset: boolean
}

export default function ComplianceTabs({ active, onChange, mfjOffset }: Props) {
  return (
    <nav
      className="sticky z-30 border-b border-white/10 bg-[#0a0e27]/90 px-6 backdrop-blur"
      style={{ top: mfjOffset ? '172px' : '80px' }}
    >
      <div className="-mb-px flex items-center gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-brand-orange text-white'
                  : 'border-transparent text-white/50 hover:text-white/80'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
