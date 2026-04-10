import type { Metadata } from 'next'
import {
  Inbox,
  Search,
  Copy,
  ExternalLink,
  Info,
} from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Inquiries' }

/* ── filter tabs ──────────────────────────────────────────────── */

const tabs = [
  { label: 'All', count: 0 },
  { label: 'New', count: 0 },
  { label: 'Responded', count: 0 },
  { label: 'Archived', count: 0 },
]

/* ── page ──────────────────────────────────────────────────────── */

export default function InquiriesPage() {
  const activeTab = 'All'

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Inquiries</h1>
        <p className="mt-1 text-sm text-white/50">
          Taxpayer intake requests waiting for your response.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b border-[--member-border]">
        {tabs.map((tab) => (
          <button
            key={tab.label}
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition ${
              tab.label === activeTab
                ? 'text-brand-orange'
                : 'text-white/50 hover:text-white/70'
            }`}
          >
            {tab.label}
            <span
              className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium ${
                tab.label === activeTab
                  ? 'bg-brand-orange/20 text-brand-orange'
                  : 'bg-white/10 text-white/40'
              }`}
            >
              {tab.count}
            </span>
            {tab.label === activeTab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-orange" />
            )}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          placeholder="Search by name or service..."
          className="w-full rounded-xl border border-[--member-border] bg-[--member-card] py-3 pl-11 pr-4 text-sm text-white placeholder-white/30 outline-none transition focus:border-brand-orange/40 focus:bg-[--member-card-hover]"
        />
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center rounded-xl border border-[--member-border] bg-[--member-card] px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-orange/10">
          <Inbox className="h-8 w-8 text-brand-orange/60" />
        </div>
        <h3 className="mt-5 text-lg font-semibold text-white">No inquiries yet</h3>
        <p className="mt-2 max-w-sm text-sm text-white/50">
          When taxpayers find your profile and submit an intake request, their
          inquiries will appear here. Share your profile link to start receiving
          leads.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-4 py-2 text-sm font-medium text-white shadow transition hover:opacity-90">
            <Copy className="h-4 w-4" />
            Copy Profile Link
          </button>
          <Link
            href="/profile"
            className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10"
          >
            <ExternalLink className="h-4 w-4" />
            View Profile
          </Link>
        </div>
      </div>

      {/* Help message */}
      <div className="rounded-xl border border-emerald-500/20 border-l-emerald-400 border-l-4 bg-emerald-500/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p className="text-sm text-emerald-300/80">
            Select an inquiry to view details and respond to taxpayer requests.
          </p>
        </div>
      </div>
    </div>
  )
}
