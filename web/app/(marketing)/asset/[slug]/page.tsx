export const runtime = 'edge'

import type { Metadata } from 'next'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

interface AssetPageData {
  headline: string
  subheadline: string
  client_gap_analysis: string[]
  new_client_value: string
  tier_comparison: {
    active: { price: string; value: string }
    featured: { price: string; value: string }
    premier: { price: string; value: string }
  }
  ttmp_crosssell: {
    pitch: string
    url: string
    price: string
  }
  cta_pricing_url: string
  cta_directory_url: string
  cta_booking_url: string
}

interface ProspectData {
  slug: string
  name: string
  credential: string
  city: string
  state: string
  firm: string
  asset_page: AssetPageData
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  return {
    title: `Practice Analysis | Virtual Launch Pro`,
    description: `Personalized practice analysis for tax professionals in your area.`,
    robots: { index: false, follow: false },
  }
}

async function getAssetData(slug: string): Promise<ProspectData | null> {
  try {
    const res = await fetch(`${API_URL}/v1/scale/asset/${slug}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

const CREDENTIAL_LABELS: Record<string, string> = {
  EA: 'Enrolled Agent',
  CPA: 'Certified Public Accountant',
  JD: 'Tax Attorney',
}

const GAP_ICONS = [
  // Search icon
  <svg key="search" className="h-6 w-6 shrink-0 text-brand-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" /></svg>,
  // User icon
  <svg key="user" className="h-6 w-6 shrink-0 text-brand-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-4 4c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4Z" /></svg>,
  // Chart icon
  <svg key="chart" className="h-6 w-6 shrink-0 text-brand-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 16l4-4 4 4 5-5" /></svg>,
]

const TIERS = [
  { key: 'active', label: 'Active', highlighted: false },
  { key: 'featured', label: 'Featured', highlighted: true },
  { key: 'premier', label: 'Premier', highlighted: false },
] as const

function TierFeatures({ tier }: { tier: string }) {
  const features: Record<string, string[]> = {
    active: [
      'Searchable directory listing',
      '2 transcript tokens/mo',
      '5 game tokens/mo',
      'Basic client matching',
    ],
    featured: [
      'Sponsored placement in directory',
      '5 transcript tokens/mo',
      '15 game tokens/mo',
      'Priority client matching',
      'Profile analytics',
    ],
    premier: [
      'Placement on 3 platforms',
      '10 transcript tokens/mo',
      '40 game tokens/mo',
      'Advanced client matching',
      'Dedicated onboarding call',
      'Priority support',
    ],
  }
  return (
    <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">
      {(features[tier] ?? []).map((f) => (
        <li key={f} className="flex items-start gap-2">
          <span className="mt-0.5 text-brand-orange">&#10003;</span>
          <span>{f}</span>
        </li>
      ))}
    </ul>
  )
}

export default async function AssetPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const data = await getAssetData(slug)

  if (!data || !data.asset_page) {
    return (
      <section className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-24 text-center">
        <h1 className="text-3xl font-bold text-[var(--fg)] md:text-4xl">
          Page not found
        </h1>
        <p className="mt-4 text-[var(--muted)]">
          This practice analysis is no longer available.
        </p>
        <Link
          href="/pricing"
          className="mt-8 inline-block rounded-lg bg-gradient-brand px-6 py-3 font-semibold text-white hover:opacity-90"
        >
          View membership tiers
        </Link>
      </section>
    )
  }

  const ap = data.asset_page
  const credentialLabel = CREDENTIAL_LABELS[data.credential] ?? data.credential

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="pb-16 text-center">
        <span className="inline-block rounded-full bg-brand-orange/20 px-3 py-1 text-sm text-brand-orange">
          Practice Analysis
        </span>
        <h1 className="mt-6 text-3xl font-bold text-[var(--fg)] md:text-5xl">
          {ap.headline}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-[var(--muted)]">
          {ap.subheadline}
        </p>
        <p className="mt-3 text-base text-[var(--fg)]">
          <span className="font-semibold">{data.name}</span>
          {' '}&mdash;{' '}
          {credentialLabel}, {data.city}, {data.state}
        </p>
      </section>

      {/* Client Gap Analysis */}
      <section className="pb-16">
        <h2 className="text-center text-2xl font-bold text-[var(--fg)] md:text-3xl">
          What your practice is missing
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {ap.client_gap_analysis.map((gap, i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-6 backdrop-blur"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-brand-orange/10">
                {GAP_ICONS[i] ?? GAP_ICONS[0]}
              </div>
              <p className="text-[var(--fg)]">{gap}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Value Section */}
      <section className="pb-16 text-center">
        <div className="rounded-xl border border-brand-orange/30 bg-brand-orange/5 p-10">
          <p className="text-lg text-[var(--muted)]">
            What 5 additional clients could mean for your practice
          </p>
          <p className="mt-4 text-4xl font-bold text-brand-orange md:text-5xl">
            {ap.new_client_value}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            estimated annual value based on {credentialLabel} billing rates
          </p>
        </div>
      </section>

      {/* Tier Comparison */}
      <section className="pb-16">
        <h2 className="text-center text-2xl font-bold text-[var(--fg)] md:text-3xl">
          Choose your membership tier
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {TIERS.map(({ key, label, highlighted }) => {
            const tier = ap.tier_comparison[key]
            return (
              <div
                key={key}
                className={`relative rounded-xl border p-6 ${
                  highlighted
                    ? 'border-brand-orange bg-brand-orange/5'
                    : 'border-[var(--line)] bg-[var(--card)]'
                } backdrop-blur`}
              >
                {highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-brand px-4 py-1 text-xs font-semibold text-white">
                    Recommended
                  </span>
                )}
                <h3 className="text-xl font-bold text-[var(--fg)]">{label}</h3>
                <p className="mt-2 text-3xl font-bold text-brand-orange">
                  {tier.price}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">{tier.value}</p>
                <TierFeatures tier={key} />
                <Link
                  href="/pricing"
                  className={`mt-6 block rounded-lg py-3 text-center font-semibold ${
                    highlighted
                      ? 'bg-gradient-brand text-white hover:opacity-90'
                      : 'border border-[var(--line)] text-[var(--fg)] hover:bg-[var(--card)]'
                  }`}
                >
                  Get started
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      {/* TTMP Cross-sell */}
      <section className="pb-16">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-8 text-center backdrop-blur md:p-10">
          <h2 className="text-xl font-bold text-[var(--fg)] md:text-2xl">
            {ap.ttmp_crosssell.pitch}
          </h2>
          <p className="mt-3 text-[var(--muted)]">{ap.ttmp_crosssell.price}</p>
          <a
            href={ap.ttmp_crosssell.url}
            className="mt-6 inline-block rounded-lg border border-brand-orange px-6 py-3 font-semibold text-brand-orange hover:bg-brand-orange/10"
          >
            Try transcript automation
          </a>
        </div>
      </section>

      {/* Footer CTAs */}
      <section className="flex flex-col items-center gap-4 pb-8 sm:flex-row sm:justify-center">
        <Link
          href="/pricing"
          className="rounded-lg bg-gradient-brand px-8 py-3 font-semibold text-white hover:opacity-90"
        >
          See all membership tiers
        </Link>
        <a
          href="https://taxmonitor.pro/directory"
          className="rounded-lg border border-[var(--line)] px-8 py-3 font-semibold text-[var(--fg)] hover:bg-[var(--card)]"
        >
          Browse the directory
        </a>
      </section>
    </div>
  )
}
