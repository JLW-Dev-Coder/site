export const runtime = 'edge'

import type { Metadata } from 'next'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

interface ProblemCard {
  title: string
  body: string
}

interface ValueSection {
  heading: string
  revenue_range: string
  body: string
}

interface TierInfo {
  price: string
  pitch: string
  includes: string
}

interface TtmpCrosssell {
  heading: string
  body: string
  url: string
  cta: string
}

interface AssetPageData {
  headline: string
  subheadline: string
  credential_label: string
  revenue_range: string
  problem_cards: ProblemCard[]
  value_section: ValueSection
  tier_comparison: {
    active: TierInfo
    featured: TierInfo
    premier: TierInfo
  }
  ttmp_crosssell: TtmpCrosssell
  cta_pricing_url: string
  cta_directory_url: string
}

interface ProspectData {
  slug: string
  name: string
  credential: string
  credential_label: string
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

const PROBLEM_ICONS = [
  <svg key="search" className="h-6 w-6 shrink-0 text-brand-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" /></svg>,
  <svg key="user" className="h-6 w-6 shrink-0 text-brand-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-4 4c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4Z" /></svg>,
  <svg key="clock" className="h-6 w-6 shrink-0 text-brand-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M12 6v6l4 2" /></svg>,
]

const TIERS = [
  { key: 'active', label: 'Active', highlighted: false },
  { key: 'featured', label: 'Featured', highlighted: true },
  { key: 'premier', label: 'Premier', highlighted: false },
] as const

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

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="pb-16 text-center">
        <span className="inline-block rounded-full bg-brand-orange/20 px-3 py-1 text-sm text-brand-orange">
          Practice analysis
        </span>
        <h1 className="mt-6 text-3xl font-bold leading-tight text-[var(--fg)] md:text-5xl">
          {ap.headline}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
          {ap.subheadline}
        </p>
        <p className="mt-4 text-base text-[var(--muted)]">
          {ap.credential_label} · {data.city}, {data.state}
        </p>
      </section>

      {/* Section 1 — The problem */}
      <section className="pb-16">
        <h2 className="text-center text-2xl font-bold text-[var(--fg)] md:text-3xl">
          Where clients are looking — and not finding you
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {ap.problem_cards.map((card, i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-6 backdrop-blur"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-brand-orange/10">
                {PROBLEM_ICONS[i] ?? PROBLEM_ICONS[0]}
              </div>
              <h3 className="mb-2 text-lg font-semibold text-[var(--fg)]">
                {card.title}
              </h3>
              <p className="text-sm leading-relaxed text-[var(--muted)]">
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2 — The value */}
      <section className="pb-16">
        <h2 className="text-center text-2xl font-bold text-[var(--fg)] md:text-3xl">
          {ap.value_section.heading}
        </h2>
        <div className="mt-10 rounded-xl border border-brand-orange/30 bg-brand-orange/5 p-8 md:p-10">
          <p className="text-center text-4xl font-bold text-brand-orange md:text-5xl">
            {ap.value_section.revenue_range} per year
          </p>
          <p className="mx-auto mt-4 max-w-xl text-center leading-relaxed text-[var(--muted)]">
            {ap.value_section.body}
          </p>
        </div>
      </section>

      {/* Section 3 — Tiers */}
      <section className="pb-16">
        <h2 className="text-center text-2xl font-bold text-[var(--fg)] md:text-3xl">
          Choose how you want to grow
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {TIERS.map(({ key, label, highlighted }) => {
            const tier = ap.tier_comparison[key]
            return (
              <div
                key={key}
                className={`relative flex flex-col rounded-xl border p-6 ${
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
                <p className="mt-3 leading-relaxed text-[var(--fg)]">
                  {tier.pitch}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                  Includes: {tier.includes}
                </p>
                <Link
                  href="/pricing"
                  className={`mt-auto block rounded-lg py-3 text-center font-semibold ${
                    highlighted
                      ? 'mt-6 bg-gradient-brand text-white hover:opacity-90'
                      : 'mt-6 border border-[var(--line)] text-[var(--fg)] hover:bg-[var(--card)]'
                  }`}
                >
                  Get started &rarr;
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      {/* Section 4 — TTMP cross-sell */}
      <section className="pb-16">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-8 text-center backdrop-blur md:p-10">
          <h2 className="text-xl font-bold text-[var(--fg)] md:text-2xl">
            {ap.ttmp_crosssell.heading}
          </h2>
          <p className="mx-auto mt-3 max-w-lg leading-relaxed text-[var(--muted)]">
            {ap.ttmp_crosssell.body}
          </p>
          <a
            href={ap.ttmp_crosssell.url}
            className="mt-6 inline-block rounded-lg border border-brand-orange px-6 py-3 font-semibold text-brand-orange hover:bg-brand-orange/10"
          >
            {ap.ttmp_crosssell.cta} &rarr;
          </a>
        </div>
      </section>

      {/* Section 5 — Footer CTAs */}
      <section className="flex flex-col items-center gap-4 pb-8 sm:flex-row sm:justify-center">
        <Link
          href="/pricing"
          className="rounded-lg bg-gradient-brand px-8 py-3 font-semibold text-white hover:opacity-90"
        >
          See all membership tiers &rarr;
        </Link>
        <a
          href="https://taxmonitor.pro/directory"
          className="rounded-lg border border-[var(--line)] px-8 py-3 font-semibold text-[var(--fg)] hover:bg-[var(--card)]"
        >
          Browse the professional directory &rarr;
        </a>
      </section>
    </div>
  )
}
