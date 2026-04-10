'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

/* ------------------------------------------------------------------ */
/*  Types (nested profile shape per vlp.profile.public.v1)            */
/* ------------------------------------------------------------------ */

interface ProfileAvatar {
  upload_type: string
  initials_fallback: boolean
  display_dimensions: { width: number; height: number }
  file: { file_type: string; width: number; height: number } | null
}

interface ProfileSection {
  name: string
  slug: string
  status: string
  status_badge_label?: string
  profile_type: string
  initials: string
  avatar: ProfileAvatar
}

interface ProfessionalSection {
  profession: string[]
  credentials: string[]
  firm_name: string | null
  years_experience: number
}

interface HeroSection {
  headline: string
  location_label: string
  rating_label: string
  years_experience_label: string
  credential_badges: { label: string; style_key: string }[]
}

interface LocationSection {
  city: string
  state: string
  country: string
  zip: string | null
}

interface BioSection {
  bio_short: string
  bio_full_paragraphs: string[]
}

interface ContactSection {
  contact_email: string | null
  phone: string | null
  website: string | null
  availability_display: string | null
  timezone: string | null
  languages: string[]
  weekly_availability: { day: string; enabled: boolean; start_time: string | null; end_time: string | null }[]
}

interface ServiceItem {
  title: string
  description: string
  icon: string
}

interface ButtonConfig {
  show: boolean
  active: boolean
  label: string
  mode: string
  url: string | null
}

interface ScheduleButton extends ButtonConfig {
  provider_label: string
  behavior_phrase: string
  description: string | null
  description_mode: string
  event_type_label: string | null
  event_type_duration_minutes: number | null
}

interface QuickStat {
  label: string
  value: string
}

interface ReviewsSummary {
  average_rating: number
  review_count: number
}

interface ReviewItem {
  name: string
  rating: number
  text: string
}

interface Profile {
  professionalId: string
  profile: ProfileSection
  professional: ProfessionalSection
  hero: HeroSection
  location: LocationSection
  bio: BioSection
  contact: ContactSection
  services_offered: { items: ServiceItem[] }
  specializations: { client_types: string[] }
  credentials_experience: {
    licenses_certifications: { title: string; subtitle?: string | null }[]
    background_items: { title: string; date_label: string; description: string }[]
  }
  quick_stats: QuickStat[]
  reviews: {
    enabled: boolean
    allow_submission: boolean
    summary: ReviewsSummary
    items: ReviewItem[]
  }
  buttons: {
    schedule_button: ScheduleButton
    contact_button: ButtonConfig
    review_button: ButtonConfig
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function getCredentialColor(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('attorney') || l === 'jd') return 'bg-purple-500/20 text-purple-300 border-purple-500/30'
  if (l.includes('cpa')) return 'bg-blue-500/20 text-blue-300 border-blue-500/30'
  if (l.includes('enrolled agent') || l === 'ea') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
  if (l.includes('erpa')) return 'bg-teal-500/20 text-teal-300 border-teal-500/30'
  if (l.includes('actuary')) return 'bg-pink-500/20 text-pink-300 border-pink-500/30'
  return 'bg-brand-orange/20 text-orange-300 border-brand-orange/30'
}

function getStyleKeyColor(key: string): string {
  if (key === 'attorney') return 'bg-purple-500/20 text-purple-300 border-purple-500/30'
  if (key === 'cpa') return 'bg-blue-500/20 text-blue-300 border-blue-500/30'
  if (key === 'ea') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
  if (key === 'featured') return 'bg-brand-orange/20 text-orange-300 border-brand-orange/30'
  return 'bg-white/10 text-white/60 border-white/20'
}

/* ------------------------------------------------------------------ */
/*  Skeleton / Error states                                           */
/* ------------------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-4 py-12">
      <div className="rounded-2xl border border-[--line] bg-[--card] p-8">
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
          <div className="h-24 w-24 rounded-full bg-white/10" />
          <div className="flex-1 space-y-3">
            <div className="mx-auto h-7 w-64 rounded bg-white/10 md:mx-0" />
            <div className="mx-auto h-4 w-48 rounded bg-white/10 md:mx-0" />
            <div className="mx-auto flex gap-2 md:mx-0">
              <div className="h-6 w-20 rounded-full bg-white/10" />
              <div className="h-6 w-24 rounded-full bg-white/10" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
        <svg className="h-8 w-8 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-[--fg]">Profile Not Found</h2>
      <p className="mt-2 text-sm text-[--muted]">{message}</p>
      <a
        href="https://taxmonitor.pro/directory"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-orange to-brand-amber px-6 py-3 text-sm font-bold text-slate-950 transition hover:opacity-90"
      >
        Browse Directory
      </a>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  No-data placeholder                                               */
/* ------------------------------------------------------------------ */

function EmptySection({ label }: { label: string }) {
  return (
    <p className="text-sm italic text-[--muted]">No {label} yet</p>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                         */
/* ------------------------------------------------------------------ */

export default function PublicProfilePage() {
  const params = useParams()
  const id = params.id as string

  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) { setError('No profile ID provided.'); setLoading(false); return }

    fetch(`https://api.virtuallaunch.pro/v1/profiles/public/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('not found')
        const data = await res.json()
        setProfile(data.profile)
      })
      .catch(() => setError('Profile not found or could not be loaded.'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <LoadingSkeleton />
  if (error || !profile) return <ErrorState message={error || 'Profile not found.'} />

  /* Derived data from nested sections */
  const name = profile.profile.name || 'Unknown'
  const initials = profile.profile.initials || getInitials(name)
  const locationLabel = profile.hero.location_label || [profile.location.city, profile.location.state].filter(Boolean).join(', ')
  const bios = profile.bio.bio_full_paragraphs || []
  const professions = profile.professional.profession || []
  const services = (profile.services_offered.items || []).map((i) => i.title)
  const credentials = profile.professional.credentials || []
  const languages = profile.contact.languages || []
  const verified = profile.profile.status === 'standard' || profile.profile.status === 'featured'
  const headline = profile.hero.headline || profile.bio.bio_short || ''
  const credentialBadges = profile.hero.credential_badges || []
  const clientTypes = profile.specializations.client_types || []
  const yearsExp = profile.professional.years_experience
  const contactEmail = profile.contact.contact_email
  const phone = profile.contact.phone
  const website = profile.contact.website
  const firmName = profile.professional.firm_name
  const availabilityDisplay = profile.contact.availability_display
  const scheduleButton = profile.buttons.schedule_button
  const contactButton = profile.buttons.contact_button

  const stats = profile.quick_stats.length > 0
    ? profile.quick_stats
    : [
        { label: 'Years Experience', value: yearsExp > 0 ? `${yearsExp}+` : '--' },
        { label: 'Returns Filed', value: '--' },
        { label: 'Client Reviews', value: '--' },
        { label: 'Specialty Cases', value: '--' },
      ]

  return (
    <div className="min-h-screen bg-[--bg]">
      {/* Back bar */}
      <div className="border-b border-[--line]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a
            href="https://taxmonitor.pro/directory"
            className="flex items-center gap-2 text-sm text-[--muted] transition hover:text-[--fg]"
          >
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="18" height="18">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Directory
          </a>

          {verified && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
              <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="14" height="14">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Verified
            </span>
          )}
        </div>
      </div>

      {/* Hero */}
      <section className="border-b border-[--line]">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            {/* Left: avatar + meta */}
            <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-orange to-brand-amber text-2xl font-bold text-slate-950">
                {initials}
              </div>

              <div className="text-center md:text-left">
                <div className="flex items-center justify-center gap-2 md:justify-start">
                  <h1 className="text-2xl font-bold text-[--fg] md:text-3xl">{name}</h1>
                  {verified && (
                    <svg className="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  )}
                </div>

                {headline && (
                  <p className="mt-1 text-[--muted]">{headline}</p>
                )}

                {/* Credential badges from hero section */}
                {credentialBadges.length > 0 && (
                  <div className="mt-3 flex flex-wrap justify-center gap-2 md:justify-start">
                    {credentialBadges.map((badge) => (
                      <span
                        key={badge.label}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStyleKeyColor(badge.style_key)}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                )}

                {/* Location + experience */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-sm text-[--muted] md:justify-start">
                  {locationLabel && (
                    <span className="flex items-center gap-1">
                      <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="16" height="16">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {locationLabel}
                    </span>
                  )}
                  {profile.hero.years_experience_label && (
                    <>
                      <span className="text-white/20">|</span>
                      <span>{profile.hero.years_experience_label}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right: hero action buttons */}
            <div className="flex flex-col items-center gap-3 md:items-end">
              {contactButton.active && contactButton.url ? (
                <a
                  href={contactButton.url}
                  className="w-full rounded-xl bg-gradient-to-r from-brand-orange to-brand-amber px-6 py-3 text-center text-sm font-bold text-slate-950 transition hover:opacity-90 md:w-auto"
                >
                  {contactButton.label}
                </a>
              ) : (
                <button
                  disabled
                  className="w-full cursor-not-allowed rounded-xl bg-white/10 px-6 py-3 text-center text-sm font-bold text-white/40 md:w-auto"
                >
                  Contact This Professional
                </button>
              )}
              {scheduleButton.active && scheduleButton.url ? (
                <a
                  href={scheduleButton.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full rounded-xl border border-[--line] px-6 py-3 text-center text-sm font-semibold text-[--fg] transition hover:bg-[--card] md:w-auto"
                >
                  {scheduleButton.label}
                </a>
              ) : (
                <button
                  disabled
                  className="w-full cursor-not-allowed rounded-xl border border-white/10 px-6 py-3 text-center text-sm font-semibold text-white/30 md:w-auto"
                >
                  Schedule Consultation
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Quick Stats */}
      <section className="border-b border-[--line]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 py-8 md:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[--line] bg-[--card] p-5 text-center"
            >
              <span className="block text-2xl font-bold text-brand-orange">{stat.value}</span>
              <span className="mt-1 block text-xs font-semibold uppercase tracking-wider text-[--muted]">{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Body: two-column layout */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Main column */}
          <div className="flex-1 space-y-6">
            {/* About */}
            <div className="rounded-2xl border border-[--line] bg-[--card] p-6">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-brand-orange">
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="18" height="18">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                About
              </h2>
              {bios.length > 0 ? (
                bios.map((text, i) => (
                  <p key={i} className="mt-3 text-sm leading-relaxed text-[--fg] first:mt-0">{text}</p>
                ))
              ) : (
                <EmptySection label="bio information" />
              )}
            </div>

            {/* Services Offered */}
            <div className="rounded-2xl border border-[--line] bg-[--card] p-6">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-brand-orange">
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="18" height="18">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Services Offered
              </h2>
              {services.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {services.map((svc, i) => (
                    <div key={svc} className="flex items-start gap-3 rounded-xl border border-[--line] bg-white/[0.02] p-4">
                      <svg
                        className={`mt-0.5 h-5 w-5 shrink-0 ${i === 0 ? 'text-brand-orange' : 'text-emerald-400'}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className={`text-sm ${i === 0 ? 'font-semibold text-[--fg]' : 'text-[--muted]'}`}>{svc}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptySection label="services" />
              )}
            </div>

            {/* Specialties */}
            <div className="rounded-2xl border border-[--line] bg-[--card] p-6">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-brand-orange">
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="18" height="18">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Specialties
              </h2>
              {professions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {professions.map((s) => (
                    <span key={s} className={`rounded-full border px-3 py-1 text-xs font-semibold ${getCredentialColor(s)}`}>
                      {s}
                    </span>
                  ))}
                </div>
              ) : (
                <EmptySection label="specialties" />
              )}

              {/* Client Types */}
              <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-[--muted]">Client Types</h3>
              {clientTypes.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {clientTypes.map((ct) => (
                    <span key={ct} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-[--fg]">
                      {ct}
                    </span>
                  ))}
                </div>
              ) : (
                <EmptySection label="client types" />
              )}
            </div>

            {/* Credentials & Experience */}
            <div className="rounded-2xl border border-[--line] bg-[--card] p-6">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-brand-orange">
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="18" height="18">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
                Licenses & Credentials
              </h2>
              {credentials.length > 0 ? (
                <div className="space-y-3">
                  {credentials.map((cred) => (
                    <div key={cred} className="flex items-center gap-3">
                      <svg className="h-5 w-5 shrink-0 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm text-[--fg]">{cred}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptySection label="credentials" />
              )}

              {/* Background / Experience timeline */}
              {profile.credentials_experience.background_items.length > 0 && (
                <>
                  <h3 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-[--muted]">Experience</h3>
                  <div className="space-y-3">
                    {profile.credentials_experience.background_items.map((item, i) => (
                      <div key={i} className="rounded-xl border border-[--line] bg-white/[0.02] p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-[--fg]">{item.title}</span>
                          <span className="text-xs text-[--muted]">{item.date_label}</span>
                        </div>
                        {item.description && (
                          <p className="mt-1 text-xs text-[--muted]">{item.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Client Reviews */}
            <div className="rounded-2xl border border-[--line] bg-[--card] p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-brand-orange">
                  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="18" height="18">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  Client Reviews
                </h2>
                {profile.reviews.summary.review_count > 0 && (
                  <span className="text-xs text-[--muted]">{profile.reviews.summary.review_count} reviews</span>
                )}
              </div>
              <div className="mt-4">
                {profile.reviews.items.length > 0 ? (
                  <div className="space-y-4">
                    {profile.reviews.items.map((review, i) => (
                      <div key={i} className="rounded-xl border border-[--line] bg-white/[0.02] p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-[--fg]">{review.name}</span>
                          <span className="text-xs text-brand-amber">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
                        </div>
                        <p className="mt-2 text-xs text-[--muted]">{review.text}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptySection label="reviews" />
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-80 lg:shrink-0">
            <div className="lg:sticky lg:top-24">
              <div className="rounded-2xl border border-[--line] bg-[--card] p-6">
                <h3 className="mb-5 text-sm font-bold uppercase tracking-wider text-brand-orange">Contact Information</h3>

                <div className="space-y-4">
                  {locationLabel && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Location</span>
                      <span className="mt-0.5 block text-sm text-[--fg]">{locationLabel}</span>
                    </div>
                  )}
                  {firmName && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Firm</span>
                      <span className="mt-0.5 block text-sm text-[--fg]">{firmName}</span>
                    </div>
                  )}
                  {phone && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Phone</span>
                      <a href={`tel:${phone}`} className="mt-0.5 block text-sm text-[--fg] hover:text-brand-orange transition">{phone}</a>
                    </div>
                  )}
                  {contactEmail && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Email</span>
                      <a href={`mailto:${contactEmail}`} className="mt-0.5 block text-sm text-[--fg] hover:text-brand-orange transition">{contactEmail}</a>
                    </div>
                  )}
                  {availabilityDisplay && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Availability</span>
                      <span className="mt-0.5 block text-sm text-[--fg]">{availabilityDisplay}</span>
                    </div>
                  )}
                  {languages.length > 0 && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Languages</span>
                      <span className="mt-0.5 block text-sm text-[--fg]">{languages.join(', ')}</span>
                    </div>
                  )}
                </div>

                {/* Sidebar buttons */}
                <div className="mt-6 space-y-3">
                  {contactButton.active && contactButton.url ? (
                    <a
                      href={contactButton.url}
                      className="block w-full rounded-xl bg-gradient-to-r from-brand-orange to-brand-amber py-3 text-center text-sm font-bold text-slate-950 transition hover:opacity-90"
                    >
                      {contactButton.label}
                    </a>
                  ) : (
                    <button disabled className="block w-full cursor-not-allowed rounded-xl bg-white/10 py-3 text-center text-sm font-bold text-white/40">
                      Contact Now
                    </button>
                  )}
                  {scheduleButton.active && scheduleButton.url ? (
                    <a
                      href={scheduleButton.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full rounded-xl border border-[--line] py-3 text-center text-sm font-semibold text-[--fg] transition hover:bg-[--card]"
                    >
                      {scheduleButton.label}
                    </a>
                  ) : (
                    <button disabled className="block w-full cursor-not-allowed rounded-xl border border-white/10 py-3 text-center text-sm font-semibold text-white/30">
                      Schedule Consultation
                    </button>
                  )}
                  {website && (
                    <a
                      href={website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center text-sm text-[--muted] transition hover:text-brand-orange"
                    >
                      Visit Website &rarr;
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
