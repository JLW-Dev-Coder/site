'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'

const PLATFORM_LABELS: Record<string, string> = {
  vlp: 'VLP',
  tmp: 'TMP',
  ttmp: 'TTMP',
  tttmp: 'TTTMP',
  dvlp: 'DVLP',
  gvlp: 'GVLP',
  tcvlp: 'TCVLP',
  wlvlp: 'WLVLP',
}

export default function PlatformAnalyticsDetailPage() {
  const params = useParams<{ platform: string }>()
  const platform = (params?.platform || '').toLowerCase()
  const label = PLATFORM_LABELS[platform] || platform.toUpperCase() || 'Unknown'

  return (
    <div className="space-y-6">
      <Link
        href="/scale"
        className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
      >
        ← Back to Analytics
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-white">{label} Analytics</h1>
        <p className="mt-2 text-sm text-slate-400">
          Analytics detail for {label} — coming soon
        </p>
      </div>

      <div
        className="rounded-xl border p-8 text-center text-slate-400"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div className="text-base font-semibold text-white/90">
          Per-platform analytics drill-down
        </div>
        <div className="mt-2 text-sm">
          Time-series traffic, status code breakdown, top countries, and firewall events for{' '}
          <span className="text-white/90">{label}</span> will appear here.
        </div>
      </div>
    </div>
  )
}
