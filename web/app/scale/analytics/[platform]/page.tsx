'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TimeseriesPoint {
  date: string
  requests: number
  cached: number
  bytes: number
  pageViews: number
  uniques: number
}

interface TrafficData {
  total_requests: number
  cached_requests: number
  total_bytes: number
  cached_bytes: number
  page_views: number
  unique_visitors: number
  threats: number
  cache_hit_ratio: number
  timeseries: TimeseriesPoint[]
}

interface StatusCode {
  status: number
  count: number
}

interface CountryEntry {
  country: string
  requests: number
  threats: number
}

interface FirewallEntry {
  action: string
  count: number
}

interface PlatformDetail {
  ok: boolean
  error?: string
  platform: string
  domain: string
  since: string
  until: string
  shared_zone: boolean
  shared_with: string[]
  traffic: TrafficData
  status_codes: StatusCode[]
  top_paths: string[]
  top_countries: CountryEntry[]
  firewall: FirewallEntry[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const VALID_PLATFORMS = ['vlp', 'tmp', 'ttmp', 'tttmp', 'dvlp', 'gvlp', 'tcvlp', 'wlvlp'] as const

const PLATFORM_LABELS: Record<string, string> = {
  vlp: 'Virtual Launch Pro',
  tmp: 'Tax Monitor Pro',
  ttmp: 'Transcript Tax Monitor Pro',
  tttmp: 'Tax Tools Arcade',
  dvlp: 'Developers VLP',
  gvlp: 'Games VLP',
  tcvlp: 'Tax Claim VLP',
  wlvlp: 'Website Lotto VLP',
}

const PLATFORM_ABBREV: Record<string, string> = {
  vlp: 'VLP', tmp: 'TMP', ttmp: 'TTMP', tttmp: 'TTTMP',
  dvlp: 'DVLP', gvlp: 'GVLP', tcvlp: 'TCVLP', wlvlp: 'WLVLP',
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------
function formatBytes(bytes: number): string {
  const b = bytes ?? 0
  if (!b || b <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  const val = b / Math.pow(1024, i)
  return `${val < 10 ? val.toFixed(2) : val < 100 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

function formatNumber(n: number | undefined | null): string {
  const v = n ?? 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toLocaleString()
}

function pct(part: number, total: number): string {
  if (total === 0) return '0.0%'
  return `${((part / total) * 100).toFixed(1)}%`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------
const glass = {
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '0.75rem',
  backdropFilter: 'blur(10px)',
} as const

const glassHover = {
  ...glass,
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  borderColor: 'rgba(255, 255, 255, 0.12)',
} as const

const brandGradient = 'linear-gradient(to right, #f97316, #f59e0b)'
const brandGradientText = {
  background: brandGradient,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
} as const

const sectionHeading: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'rgba(148, 163, 184, 1)',
  marginBottom: '1rem',
}

const kpiNumber: React.CSSProperties = {
  fontFamily: "'Raleway', system-ui, sans-serif",
  fontSize: '1.75rem',
  fontWeight: 700,
  color: 'rgba(255, 255, 255, 0.95)',
  lineHeight: 1.1,
}

const kpiLabel: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'rgba(148, 163, 184, 0.85)',
}

const mutedText: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'rgba(148, 163, 184, 0.7)',
}

const cardTitle: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 700,
  color: 'rgba(255, 255, 255, 0.95)',
}

const cardSubtitle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'rgba(148, 163, 184, 0.7)',
  marginTop: '0.125rem',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Glass card wrapper */
function GlassCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ ...glass, padding: '1.25rem', ...style }}>
      {children}
    </div>
  )
}

/** Skeleton loading card */
function SkeletonCard({ height = '200px' }: { height?: string }) {
  return (
    <div
      style={{
        ...glass,
        height,
        background: 'linear-gradient(90deg, rgba(148,163,184,0.06) 25%, rgba(148,163,184,0.12) 50%, rgba(148,163,184,0.06) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 2s infinite',
      }}
    />
  )
}

/** Bar chart from timeseries data */
function BarChart({
  data,
  valueKey,
  formatTooltip,
}: {
  data: TimeseriesPoint[]
  valueKey: 'requests' | 'bytes'
  formatTooltip?: (val: number) => string
}) {
  const values = data.map((d) => d[valueKey])
  const maxVal = Math.max(...values, 1)
  const peakIdx = values.indexOf(Math.max(...values))
  const peakDate = data[peakIdx]?.date || ''
  const peakVal = values[peakIdx] || 0
  const fmt = formatTooltip || formatNumber

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '140px', padding: '0.5rem 0' }}>
        {data.map((d, i) => {
          const h = maxVal > 0 ? (values[i] / maxVal) * 100 : 0
          return (
            <div
              key={d.date}
              title={`${fmtShortDate(d.date)}: ${fmt(values[i])}`}
              style={{
                flex: 1,
                minWidth: 0,
                height: `${Math.max(h, 2)}%`,
                background: 'linear-gradient(to top, #f97316, #fb923c)',
                borderRadius: '0.375rem 0.375rem 0 0',
                opacity: 0.85,
                cursor: 'pointer',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.85' }}
            />
          )
        })}
      </div>
      <p style={mutedText}>Peak: {fmt(peakVal)} on {peakDate ? fmtShortDate(peakDate) : '—'}</p>
    </div>
  )
}

/** Semicircular gauge for cache ratio */
function CacheGauge({ ratio }: { ratio: number }) {
  const pctVal = (ratio ?? 0) * 100
  const angle = -90 + (pctVal / 100) * 180
  const color = pctVal > 50 ? '#22c55e' : pctVal > 20 ? '#f59e0b' : '#ef4444'
  const label = pctVal > 50 ? 'Optimal performance' : pctVal > 20 ? 'Acceptable' : 'Needs improvement'

  // SVG semicircle
  const cx = 100, cy = 100, r = 80
  const startAngle = Math.PI
  const endAngle = 0

  function polarToCartesian(a: number) {
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  }

  const bgStart = polarToCartesian(startAngle)
  const bgEnd = polarToCartesian(endAngle)
  const bgPath = `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 0 1 ${bgEnd.x} ${bgEnd.y}`

  // Needle
  const needleAngle = Math.PI - (pctVal / 100) * Math.PI
  const needleTip = polarToCartesian(needleAngle)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width="200" height="120" viewBox="0 10 200 110">
        {/* Background arc — gray */}
        <path d={bgPath} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="12" strokeLinecap="round" />
        {/* Colored progress arc */}
        {pctVal > 0 && (() => {
          const progAngle = Math.PI - (pctVal / 100) * Math.PI
          const progEnd = polarToCartesian(progAngle)
          const largeArc = pctVal > 50 ? 1 : 0
          const progPath = `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 ${largeArc} 1 ${progEnd.x} ${progEnd.y}`
          return <path d={progPath} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" />
        })()}
        {/* Needle */}
        <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y} stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill="rgba(255,255,255,0.9)" />
      </svg>
      <span style={{ ...kpiNumber, fontSize: '1.5rem', color, marginTop: '-0.25rem' }}>{pctVal.toFixed(1)}%</span>
      <span style={{ ...mutedText, marginTop: '0.25rem' }}>{label}</span>
    </div>
  )
}

/** Donut chart SVG */
function DonutChart({ cached, total }: { cached: number; total: number }) {
  const uncached = total - cached
  const ratio = total > 0 ? cached / total : 0
  const circumference = 2 * Math.PI * 40
  const cachedLen = ratio * circumference
  const uncachedLen = circumference - cachedLen

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width="160" height="160" viewBox="0 0 100 100">
        {/* Uncached ring */}
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(148,163,184,0.3)" strokeWidth="10"
          strokeDasharray={`${uncachedLen} ${cachedLen}`}
          strokeDashoffset={-cachedLen}
          transform="rotate(-90 50 50)" />
        {/* Cached ring */}
        <circle cx="50" cy="50" r="40" fill="none" stroke="#f97316" strokeWidth="10"
          strokeDasharray={`${cachedLen} ${uncachedLen}`}
          transform="rotate(-90 50 50)" />
        {/* Center text */}
        <text x="50" y="47" textAnchor="middle" fill="rgba(255,255,255,0.95)" fontSize="14" fontWeight="700" fontFamily="'Raleway', system-ui">{pct(cached, total)}</text>
        <text x="50" y="60" textAnchor="middle" fill="rgba(148,163,184,0.7)" fontSize="6">cache ratio</text>
      </svg>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
        <span style={{ ...mutedText, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} />
          Cached: {formatNumber(cached)}
        </span>
        <span style={{ ...mutedText, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(148,163,184,0.4)', display: 'inline-block' }} />
          Uncached: {formatNumber(uncached)}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------
export default function PlatformAnalyticsDetailPage() {
  const params = useParams<{ platform: string }>()
  const platform = (params?.platform || '').toLowerCase()
  const isValid = (VALID_PLATFORMS as readonly string[]).includes(platform)
  const label = PLATFORM_LABELS[platform] || platform.toUpperCase()
  const abbrev = PLATFORM_ABBREV[platform] || platform.toUpperCase()

  const [data, setData] = useState<PlatformDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [granularity, setGranularity] = useState<'hourly' | 'daily' | 'monthly'>('daily')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!isValid) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`https://api.virtuallaunch.pro/v1/admin/analytics/${platform}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: PlatformDetail = await res.json()
      if (!json.ok) throw new Error(json.error || 'Unknown error')
      setData(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [platform, isValid])

  useEffect(() => { fetchData() }, [fetchData])

  // Unknown platform
  if (!isValid) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ color: 'rgba(255,255,255,0.95)', fontSize: '1.5rem', fontWeight: 700 }}>Unknown platform</h1>
        <p style={{ ...mutedText, marginTop: '0.5rem' }}>
          &quot;{params?.platform}&quot; is not a recognized platform.
        </p>
        <Link href="/scale" style={{ color: '#f97316', textDecoration: 'none', fontSize: '0.875rem', marginTop: '1rem', display: 'inline-block' }}>
          ← Back to Analytics
        </Link>
      </div>
    )
  }

  // Loading skeleton
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <style>{`@keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }`}</style>
        <SkeletonCard height="100px" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} height="120px" />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height="220px" />)}
        </div>
      </div>
    )
  }

  // Error state
  if (error || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <Link href="/scale" style={{ color: 'rgba(148,163,184,0.9)', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Back to Analytics
        </Link>
        <GlassCard style={{ borderColor: 'rgba(239, 68, 68, 0.4)', backgroundColor: 'rgba(239, 68, 68, 0.08)' }}>
          <p style={{ color: '#ef4444', fontWeight: 600, marginBottom: '0.5rem' }}>Failed to load analytics</p>
          <p style={mutedText}>{error || 'No data returned'}</p>
          <button
            onClick={fetchData}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1.25rem',
              background: brandGradient,
              color: '#0f172a',
              border: 'none',
              borderRadius: '0.5rem',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </GlassCard>
      </div>
    )
  }

  // Destructure data with safe defaults
  const { traffic: rawTraffic, status_codes: rawStatusCodes, top_countries: rawCountries, firewall: rawFirewall, shared_zone, shared_with } = data
  const traffic = {
    total_requests: rawTraffic?.total_requests ?? 0,
    cached_requests: rawTraffic?.cached_requests ?? 0,
    total_bytes: rawTraffic?.total_bytes ?? 0,
    cached_bytes: rawTraffic?.cached_bytes ?? 0,
    page_views: rawTraffic?.page_views ?? 0,
    unique_visitors: rawTraffic?.unique_visitors ?? 0,
    threats: rawTraffic?.threats ?? 0,
    cache_hit_ratio: rawTraffic?.cache_hit_ratio ?? 0,
    timeseries: rawTraffic?.timeseries ?? [],
  }
  const status_codes = rawStatusCodes ?? []
  const top_countries = rawCountries ?? []
  const firewall = rawFirewall ?? []
  const uncached = traffic.total_requests - traffic.cached_requests
  const cachedPct = pct(traffic.cached_requests, traffic.total_requests)
  const uncachedPct = pct(uncached, traffic.total_requests)

  // Status code grouping
  const statusGroups: Record<string, { count: number; color: string }> = {
    '2xx': { count: 0, color: '#22c55e' },
    '3xx': { count: 0, color: '#3b82f6' },
    '4xx': { count: 0, color: '#f59e0b' },
    '5xx': { count: 0, color: '#ef4444' },
  }
  for (const sc of status_codes) {
    const group = `${Math.floor(sc.status / 100)}xx`
    if (statusGroups[group]) statusGroups[group].count += sc.count
  }
  const totalStatusCount = status_codes.reduce((sum, s) => sum + s.count, 0)

  // Filtered status codes for the detail table
  const filteredStatusCodes = statusFilter
    ? status_codes.filter((sc) => `${Math.floor(sc.status / 100)}xx` === statusFilter)
    : status_codes

  // Threats by country sorted by threats desc
  const threatCountries = top_countries.filter((c) => c.threats > 0).sort((a, b) => b.threats - a.threats)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Shimmer keyframes for any dynamic skeletons */}
      <style>{`@keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }`}</style>

      {/* ================================================================ */}
      {/* HEADER                                                           */}
      {/* ================================================================ */}
      <GlassCard style={{ padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={brandGradientText as React.CSSProperties}>{abbrev}</span>
              <span style={{ color: 'rgba(148,163,184,0.6)', fontWeight: 400 }}>/</span>
              <span style={{ color: 'rgba(148,163,184,0.8)', fontWeight: 400, fontSize: '1.125rem' }}>Analytics</span>
            </h1>
            <p style={{ ...mutedText, marginTop: '0.25rem' }}>{data.domain}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Date range pill */}
            <span style={{
              ...glass,
              padding: '0.375rem 0.75rem',
              fontSize: '0.75rem',
              color: 'rgba(255,255,255,0.8)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
            }}>
              <span style={{ color: '#f97316' }}>&#9679;</span>
              {fmtDate(data.since)} — {fmtDate(data.until)}
            </span>
            {/* Export button placeholder */}
            <button
              disabled
              style={{
                ...glass,
                padding: '0.375rem 0.75rem',
                fontSize: '0.75rem',
                color: 'rgba(148,163,184,0.5)',
                cursor: 'not-allowed',
                background: 'rgba(255,255,255,0.04)',
              }}
              title="Export coming soon"
            >
              Export
            </button>
            {/* Production badge */}
            <span style={{
              padding: '0.25rem 0.625rem',
              fontSize: '0.65rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderRadius: '9999px',
              background: 'rgba(34, 197, 94, 0.15)',
              color: '#22c55e',
              border: '1px solid rgba(34, 197, 94, 0.3)',
            }}>
              Production
            </span>
          </div>
        </div>
      </GlassCard>

      {/* Back link */}
      <Link href="/scale" style={{ color: 'rgba(148,163,184,0.9)', textDecoration: 'none', fontSize: '0.875rem', transition: 'color 0.15s' }}>
        ← Back to Analytics
      </Link>

      {/* Shared zone banner */}
      {shared_zone && (
        <div style={{
          ...glass,
          padding: '0.75rem 1rem',
          borderColor: 'rgba(245, 158, 11, 0.3)',
          backgroundColor: 'rgba(245, 158, 11, 0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.8rem',
          color: '#f59e0b',
        }}>
          <span style={{ fontSize: '1rem' }}>&#9888;</span>
          Zone data includes all {(shared_with || []).join(', ')} subdomains. Per-subdomain isolation requires Cloudflare Pro.
        </div>
      )}

      {/* ================================================================ */}
      {/* GRANULARITY TOGGLE                                               */}
      {/* ================================================================ */}
      <div>
        <div style={{
          display: 'inline-flex',
          gap: '0.25rem',
          padding: '0.25rem',
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '0.75rem',
          backdropFilter: 'blur(10px)',
        }}>
          {(['hourly', 'daily', 'monthly'] as const).map((g) => {
            const active = granularity === g
            return (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                style={{
                  padding: '0.5rem 1.25rem',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: active ? '#0f172a' : 'rgba(148, 163, 184, 0.9)',
                  background: active ? brandGradient : 'transparent',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: active ? '0 0 12px rgba(249, 115, 22, 0.3)' : 'none',
                }}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            )
          })}
        </div>
        {/* TODO: wire granularity when Pro plan enables hourly/adaptive datasets */}
        <p style={{ ...mutedText, marginTop: '0.375rem', fontSize: '0.7rem' }}>
          Showing: {granularity.charAt(0).toUpperCase() + granularity.slice(1)}
        </p>
      </div>

      {/* ================================================================ */}
      {/* 6 KPI CARDS                                                      */}
      {/* ================================================================ */}
      <style>{`
        .kpi-grid-detail { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
        @media (min-width: 768px) { .kpi-grid-detail { grid-template-columns: repeat(3, 1fr); } }
        @media (min-width: 1280px) { .kpi-grid-detail { grid-template-columns: repeat(6, 1fr); } }
        .section-grid { display: grid; grid-template-columns: repeat(1, 1fr); gap: 1rem; }
        @media (min-width: 768px) { .section-grid { grid-template-columns: repeat(2, 1fr); } }
      `}</style>
      <div className="kpi-grid-detail">
        {(() => {
          const kpis = [
            { label: 'Page Views', value: formatNumber(traffic.page_views), sub: 'Proxied page views', iconColor: '#f97316' },
            { label: 'Requests', value: formatNumber(traffic.total_requests), sub: 'Total HTTP requests', iconColor: '#f97316' },
            {
              label: 'Unique Visitors',
              value: traffic.unique_visitors === 0 ? 'N/A' : formatNumber(traffic.unique_visitors),
              sub: traffic.unique_visitors === 0 ? 'Free plan' : 'Approx. visitors',
              iconColor: '#f97316',
              muted: traffic.unique_visitors === 0,
            },
            { label: 'Bandwidth', value: formatBytes(traffic.total_bytes), sub: 'Data transferred', iconColor: '#f97316' },
            { label: 'Cache Hits', value: pct(traffic.cached_requests, traffic.total_requests), sub: 'Cache hit ratio', iconColor: '#f97316' },
            { label: 'Threats', value: formatNumber(traffic.threats), sub: 'Security events', iconColor: traffic.threats > 0 ? '#ef4444' : '#f97316' },
          ]
          return kpis.map((k) => (
            <GlassCard key={k.label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: k.iconColor, display: 'inline-block',
                  boxShadow: `0 0 6px ${k.iconColor}40`,
                }} />
                <span style={kpiLabel}>{k.label}</span>
                {/* TODO: compute trend from comparing current period vs prior period */}
              </div>
              <div style={{ ...kpiNumber, ...(k.muted ? { color: 'rgba(148,163,184,0.5)', fontSize: '1.25rem' } : {}) }}>
                {k.value}
              </div>
              <p style={{ ...mutedText, marginTop: '0.25rem' }}>{k.sub}</p>
            </GlassCard>
          ))
        })()}
      </div>

      {/* ================================================================ */}
      {/* SECTION 1 — Core Traffic Analytics                               */}
      {/* ================================================================ */}
      <h2 style={sectionHeading}>Core Traffic Analytics</h2>
      <div className="section-grid">

        {/* Requests Over Time */}
        <GlassCard>
          <div style={cardTitle}>Requests Over Time</div>
          <div style={cardSubtitle}>Total HTTP requests</div>
          <div style={{ marginTop: '0.75rem' }}>
            <BarChart data={traffic.timeseries} valueKey="requests" formatTooltip={formatNumber} />
          </div>
        </GlassCard>

        {/* Cached vs Uncached */}
        <GlassCard>
          <div style={cardTitle}>Cached vs Uncached</div>
          <div style={cardSubtitle}>Request breakdown</div>
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Cached bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)' }}>Cached</span>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>{formatNumber(traffic.cached_requests)} ({cachedPct})</span>
              </div>
              <div style={{ height: '10px', borderRadius: '5px', background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: traffic.total_requests > 0 ? `${(traffic.cached_requests / traffic.total_requests) * 100}%` : '0%',
                  background: brandGradient,
                  borderRadius: '5px',
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
            {/* Uncached bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)' }}>Uncached</span>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>{formatNumber(uncached)} ({uncachedPct})</span>
              </div>
              <div style={{ height: '10px', borderRadius: '5px', background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: traffic.total_requests > 0 ? `${(uncached / traffic.total_requests) * 100}%` : '0%',
                  background: 'linear-gradient(to right, rgba(148,163,184,0.5), rgba(148,163,184,0.3))',
                  borderRadius: '5px',
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
            {/* Legend */}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
              <span style={{ ...mutedText, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} />
                Cached: {formatNumber(traffic.cached_requests)} ({cachedPct})
              </span>
              <span style={{ ...mutedText, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(148,163,184,0.5)', display: 'inline-block' }} />
                Uncached: {formatNumber(uncached)} ({uncachedPct})
              </span>
            </div>
          </div>
        </GlassCard>

        {/* Cache Performance */}
        <GlassCard>
          <div style={cardTitle}>Cache Performance</div>
          <div style={cardSubtitle}>Hit ratio status</div>
          <div style={{ marginTop: '0.75rem' }}>
            <CacheGauge ratio={traffic.cache_hit_ratio} />
          </div>
        </GlassCard>

        {/* Bandwidth Usage */}
        <GlassCard>
          <div style={cardTitle}>Bandwidth Usage</div>
          <div style={cardSubtitle}>Data transferred per day</div>
          <div style={{ marginTop: '0.75rem' }}>
            <BarChart data={traffic.timeseries} valueKey="bytes" formatTooltip={formatBytes} />
            <p style={{ ...mutedText, marginTop: '0.25rem' }}>Total: {formatBytes(traffic.total_bytes)}</p>
          </div>
        </GlassCard>
      </div>

      {/* ================================================================ */}
      {/* SECTION 2 — Response Status                                      */}
      {/* ================================================================ */}
      <h2 style={sectionHeading}>Response Status</h2>
      <div className="section-grid">

        {/* Response Status Groups */}
        <GlassCard>
          <div style={cardTitle}>Response Status</div>
          <div style={cardSubtitle}>HTTP status breakdown</div>
          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {Object.entries(statusGroups).map(([group, { count, color }]) => (
              <div key={group} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ width: '2.5rem', fontSize: '0.8rem', fontWeight: 600, color }}>{group}</span>
                <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'rgba(148,163,184,0.1)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: totalStatusCount > 0 ? `${(count / totalStatusCount) * 100}%` : '0%',
                    background: color,
                    borderRadius: '3px',
                  }} />
                </div>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', minWidth: '3rem', textAlign: 'right' }}>
                  {formatNumber(count)}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'rgba(148,163,184,0.6)', minWidth: '3rem', textAlign: 'right' }}>
                  {pct(count, totalStatusCount)}
                </span>
              </div>
            ))}
          </div>
          {/* Chip filter */}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setStatusFilter(null)}
              style={{
                padding: '0.25rem 0.625rem',
                fontSize: '0.7rem',
                fontWeight: 600,
                borderRadius: '9999px',
                border: '1px solid',
                cursor: 'pointer',
                background: !statusFilter ? 'rgba(255,255,255,0.12)' : 'transparent',
                borderColor: !statusFilter ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
                color: !statusFilter ? 'rgba(255,255,255,0.9)' : 'rgba(148,163,184,0.7)',
              }}
            >
              All
            </button>
            {Object.entries(statusGroups).map(([group, { color }]) => (
              <button
                key={group}
                onClick={() => setStatusFilter(statusFilter === group ? null : group)}
                style={{
                  padding: '0.25rem 0.625rem',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  borderRadius: '9999px',
                  border: '1px solid',
                  cursor: 'pointer',
                  background: statusFilter === group ? `${color}22` : 'transparent',
                  borderColor: statusFilter === group ? `${color}66` : 'rgba(255,255,255,0.1)',
                  color: statusFilter === group ? color : 'rgba(148,163,184,0.7)',
                }}
              >
                {group}
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Status Detail Table */}
        <GlassCard>
          <div style={cardTitle}>Status Detail</div>
          <div style={cardSubtitle}>Individual status codes</div>
          <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Count</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>% of Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredStatusCodes.slice(0, 10).map((sc) => {
                  const group = `${Math.floor(sc.status / 100)}xx`
                  const color = statusGroups[group]?.color || 'rgba(255,255,255,0.7)'
                  return (
                    <tr key={sc.status} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '0.5rem 0', color, fontWeight: 600 }}>{sc.status}</td>
                      <td style={{ padding: '0.5rem 0', textAlign: 'right', color: 'rgba(255,255,255,0.8)' }}>{formatNumber(sc.count)}</td>
                      <td style={{ padding: '0.5rem 0', textAlign: 'right', color: 'rgba(148,163,184,0.6)' }}>{pct(sc.count, totalStatusCount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filteredStatusCodes.length > 10 && (
              <p style={{ ...mutedText, marginTop: '0.5rem' }}>and {filteredStatusCodes.length - 10} more</p>
            )}
          </div>
        </GlassCard>

        {/* Cache Status Donut */}
        <GlassCard>
          <div style={cardTitle}>Cache Status</div>
          <div style={cardSubtitle}>Cached vs uncached ratio</div>
          <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'center' }}>
            <DonutChart cached={traffic.cached_requests} total={traffic.total_requests} />
          </div>
        </GlassCard>

        {/* Performance Comparison */}
        <GlassCard>
          <div style={cardTitle}>Performance Comparison</div>
          <div style={cardSubtitle}>Cache efficiency breakdown</div>
          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[
              { label: 'Cache Ratio', value: pct(traffic.cached_requests, traffic.total_requests) },
              { label: 'Cached Requests', value: formatNumber(traffic.cached_requests) },
              { label: 'Bandwidth Saved', value: formatBytes(traffic.cached_bytes) },
              { label: 'Bandwidth Saved %', value: pct(traffic.cached_bytes, traffic.total_bytes) },
            ].map((row) => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize: '0.8rem', color: 'rgba(148,163,184,0.8)' }}>{row.label}</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{row.value}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* ================================================================ */}
      {/* SECTION 3 — Geographic & Source Analytics                         */}
      {/* ================================================================ */}
      <h2 style={sectionHeading}>Geographic &amp; Source Analytics</h2>
      <div className="section-grid">

        {/* Traffic by Country */}
        <GlassCard>
          <div style={cardTitle}>Traffic by Country</div>
          <div style={cardSubtitle}>Top 10 by request volume</div>
          {top_countries.length === 0 ? (
            <p style={{ ...mutedText, marginTop: '0.75rem' }}>No country data for this period</p>
          ) : (
            <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Country</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Requests</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Threats</th>
                  </tr>
                </thead>
                <tbody>
                  {top_countries.slice(0, 10).map((c) => (
                    <tr key={c.country} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '0.5rem 0', color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>{c.country}</td>
                      <td style={{ padding: '0.5rem 0', textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>{formatNumber(c.requests)}</td>
                      <td style={{ padding: '0.5rem 0', textAlign: 'right', color: c.threats > 0 ? '#ef4444' : 'rgba(148,163,184,0.5)' }}>{c.threats}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>

        {/* Threat Sources */}
        <GlassCard>
          <div style={cardTitle}>Threat Sources</div>
          <div style={cardSubtitle}>Countries by threat count</div>
          {threatCountries.length === 0 ? (
            <p style={{ ...mutedText, marginTop: '0.75rem' }}>No threat data for this period</p>
          ) : (
            <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Country</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Threats</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {threatCountries.map((c) => (
                    <tr key={c.country} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '0.5rem 0', color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>{c.country}</td>
                      <td style={{ padding: '0.5rem 0', textAlign: 'right', color: '#ef4444', fontWeight: 600 }}>{c.threats}</td>
                      <td style={{ padding: '0.5rem 0', textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>{formatNumber(c.requests)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>

        {/* Top Pages — Free plan placeholder */}
        <GlassCard>
          <div style={cardTitle}>Top Pages</div>
          <div style={cardSubtitle}>Per-path analytics</div>
          <div style={{ marginTop: '1.5rem', textAlign: 'center', padding: '1.5rem 0' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem', opacity: 0.4 }}>&#128274;</div>
            <p style={{ ...mutedText, fontSize: '0.8rem' }}>Requires Cloudflare Pro plan for per-path analytics</p>
          </div>
        </GlassCard>

        {/* Firewall Events */}
        <GlassCard>
          <div style={cardTitle}>Firewall Events</div>
          <div style={cardSubtitle}>Security event breakdown</div>
          {firewall.length === 0 ? (
            <div style={{ marginTop: '1.5rem', textAlign: 'center', padding: '1.5rem 0' }}>
              <p style={{ ...mutedText, fontSize: '0.8rem' }}>Firewall event data not available on Free plan</p>
            </div>
          ) : (
            <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem 0', color: 'rgba(148,163,184,0.7)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {firewall.map((fw) => (
                    <tr key={fw.action} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '0.5rem 0', color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>{fw.action}</td>
                      <td style={{ padding: '0.5rem 0', textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>{formatNumber(fw.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </div>

      {/* ================================================================ */}
      {/* FOOTER                                                           */}
      {/* ================================================================ */}
      <div style={{ textAlign: 'right', padding: '0.5rem 0' }}>
        <span style={{ ...mutedText, fontSize: '0.65rem' }}>Last updated: {new Date().toISOString()}</span>
      </div>
    </div>
  )
}
