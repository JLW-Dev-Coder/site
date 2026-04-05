export const runtime = 'edge'

import type { Metadata } from 'next'
import Link from 'next/link'
import AssetInteractive from './AssetInteractive'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

/* ---------- Types ---------- */

interface CalculatorField {
  id: string
  label: string
  type: string
  min: number
  max: number
  default: number
  step?: number
}

interface QualifyingQuestion {
  text: string
  detail: string
}

interface Tier {
  name: string
  price: string
  pitch: string
  recommended: boolean
}

interface AssetPageData {
  headline: string
  subheadline: string
  credential_line: string
  calculator: {
    enabled: boolean
    fields: CalculatorField[]
    result_template: string
  }
  qualifying_questions: QualifyingQuestion[]
  tiers: Tier[]
  crosssell: {
    heading: string
    body: string
    url: string
    button_text: string
  }
  about: {
    heading: string
    subheading: string
    paragraphs: string[]
    stats: { value: string; label: string }[]
  }
  ctas: {
    primary: { text: string; url: string }
    secondary: { text: string; url: string }
  }
  footer: string
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

/* ---------- Metadata ---------- */

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

/* ---------- Data fetch ---------- */

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

/* ---------- Page ---------- */

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
          {ap.credential_line}
        </p>
      </section>

      {/* Section 1 + 2 — Calculator + Qualifying questions (client component) */}
      <AssetInteractive
        calculator={ap.calculator}
        qualifying_questions={ap.qualifying_questions}
      />

      {/* Section 3 — Tiers */}
      <section className="pb-16">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-[var(--fg)] md:text-3xl">
            Choose how you want to grow
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--muted)]">
            All tiers include directory access, client intake workflow, and transcript tools.
          </p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {ap.tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-xl border p-6 backdrop-blur ${
                tier.recommended
                  ? 'border-2 border-blue-500 bg-blue-500/5'
                  : 'border-[var(--line)] bg-[var(--card)]'
              }`}
            >
              {tier.recommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-4 py-1 text-xs font-semibold text-white">
                  Recommended
                </span>
              )}
              <h3 className="text-xl font-bold text-[var(--fg)]">{tier.name}</h3>
              <p className="mt-2 text-3xl font-bold text-brand-orange">
                {tier.price}
              </p>
              <p className="mt-3 leading-relaxed text-[var(--muted)]">
                {tier.pitch}
              </p>
              <Link
                href="/pricing"
                className={`mt-auto block rounded-lg py-3 text-center font-semibold ${
                  tier.recommended
                    ? 'mt-6 bg-gradient-brand text-white hover:opacity-90'
                    : 'mt-6 border border-[var(--line)] text-[var(--fg)] hover:bg-[var(--card)]'
                }`}
              >
                Get started
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Section 4 — TTMP cross-sell */}
      <section className="pb-16">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-8 text-center backdrop-blur md:p-10">
          <h2 className="text-xl font-bold text-[var(--fg)] md:text-2xl">
            {ap.crosssell.heading}
          </h2>
          <p className="mx-auto mt-3 max-w-lg leading-relaxed text-[var(--muted)]">
            {ap.crosssell.body}
          </p>
          <a
            href={ap.crosssell.url}
            className="mt-6 inline-block rounded-lg border border-brand-orange px-6 py-3 font-semibold text-brand-orange hover:bg-brand-orange/10"
          >
            {ap.crosssell.button_text}
          </a>
        </div>
      </section>

      {/* Section 5 — About VLP */}
      <section className="pb-16">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-[var(--fg)] md:text-3xl">
            {ap.about.heading}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--muted)]">
            {ap.about.subheading}
          </p>
        </div>
        <div className="mx-auto mt-8 max-w-3xl space-y-4">
          {ap.about.paragraphs.map((p, i) => (
            <p key={i} className="leading-relaxed text-[var(--muted)]">{p}</p>
          ))}
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {ap.about.stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-6 text-center backdrop-blur"
            >
              <p className="text-3xl font-bold text-brand-orange">{stat.value}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer CTAs */}
      <section className="flex flex-col items-center gap-4 pb-8 sm:flex-row sm:justify-center">
        <Link
          href={ap.ctas.primary.url}
          className="rounded-lg bg-gradient-brand px-8 py-3 font-semibold text-white hover:opacity-90"
        >
          {ap.ctas.primary.text}
        </Link>
        <a
          href={ap.ctas.secondary.url}
          className="rounded-lg border border-[var(--line)] px-8 py-3 font-semibold text-[var(--fg)] hover:bg-[var(--card)]"
        >
          {ap.ctas.secondary.text}
        </a>
      </section>

      {/* Footer line */}
      <p className="pb-8 text-center text-sm text-[var(--muted)]">
        {ap.footer}
      </p>
    </div>
  )
}
