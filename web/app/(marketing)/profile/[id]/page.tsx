'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Profile {
  professionalId: string
  displayName: string
  fullName?: string
  initials?: string
  bioShort?: string
  yearsExperience?: string
  state?: string
  city?: string
  firmName?: string
  professions?: string[]
  otherProfession?: string
  aboutHeading?: string
  bio1?: string
  bio2?: string
  bio3?: string
  servicesHeading?: string
  primaryService?: string
  additionalServices?: string[]
  credentialsHeading?: string
  primaryCredential?: string
  additionalCredentials?: string
  email?: string
  phone?: string
  languages?: string[]
  availabilityText?: string
  calBookingUrl?: string
  website?: string
  status?: string
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

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          className={i < rating ? 'text-brand-amber' : 'text-white/20'}
          fill={i < rating ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          width="14"
          height="14"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
          />
        </svg>
      ))}
    </span>
  )
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

  /* Derived data */
  const name = profile.displayName || profile.fullName || 'Unknown'
  const initials = profile.initials || getInitials(name)
  const location = [profile.city, profile.state].filter(Boolean).join(', ')
  const bios = [profile.bio1, profile.bio2, profile.bio3].filter(Boolean)
  const professions = profile.professions || []
  const services = [
    ...(profile.primaryService ? [profile.primaryService] : []),
    ...(profile.additionalServices || []),
  ]
  const credentials = [
    profile.primaryCredential,
    ...(profile.additionalCredentials ? profile.additionalCredentials.split(',').map((s) => s.trim()) : []),
  ].filter(Boolean) as string[]
  const languages = profile.languages || []
  const verified = profile.status === 'active'
  const headline = profile.primaryService || professions[0] || profile.bioShort || ''

  /* Stat cards — show skeleton for missing data */
  const stats = [
    { label: 'Years Experience', value: profile.yearsExperience || '--' },
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

                {/* Credential badges */}
                {professions.length > 0 && (
                  <div className="mt-3 flex flex-wrap justify-center gap-2 md:justify-start">
                    {professions.map((p) => (
                      <span
                        key={p}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${getCredentialColor(p)}`}
                      >
                        {p === 'Other' && profile.otherProfession ? profile.otherProfession : p}
                      </span>
                    ))}
                  </div>
                )}

                {/* Location + experience + rating */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-sm text-[--muted] md:justify-start">
                  {location && (
                    <span className="flex items-center gap-1">
                      <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="16" height="16">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {location}
                    </span>
                  )}
                  {profile.yearsExperience && (
                    <>
                      <span className="text-white/20">|</span>
                      <span>{profile.yearsExperience} years experience</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right: hero action buttons */}
            <div className="flex flex-col items-center gap-3 md:items-end">
              {profile.email ? (
                <a
                  href={`mailto:${profile.email}`}
                  className="w-full rounded-xl bg-gradient-to-r from-brand-orange to-brand-amber px-6 py-3 text-center text-sm font-bold text-slate-950 transition hover:opacity-90 md:w-auto"
                >
                  Contact This Professional
                </a>
              ) : (
                <button
                  disabled
                  className="w-full cursor-not-allowed rounded-xl bg-white/10 px-6 py-3 text-center text-sm font-bold text-white/40 md:w-auto"
                >
                  Contact This Professional
                </button>
              )}
              {profile.calBookingUrl ? (
                <a
                  href={profile.calBookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full rounded-xl border border-[--line] px-6 py-3 text-center text-sm font-semibold text-[--fg] transition hover:bg-[--card] md:w-auto"
                >
                  Schedule Consultation
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
                {profile.aboutHeading || 'About'}
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
                {profile.servicesHeading || 'Services Offered'}
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
                      {s === 'Other' && profile.otherProfession ? profile.otherProfession : s}
                    </span>
                  ))}
                </div>
              ) : (
                <EmptySection label="specialties" />
              )}

              {/* Client Types — placeholder */}
              <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-[--muted]">Client Types</h3>
              <EmptySection label="client types" />
            </div>

            {/* Experience Timeline — placeholder */}
            <div className="rounded-2xl border border-[--line] bg-[--card] p-6">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-brand-orange">
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="18" height="18">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Experience
              </h2>
              <EmptySection label="experience" />
            </div>

            {/* Licenses & Credentials */}
            <div className="rounded-2xl border border-[--line] bg-[--card] p-6">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-brand-orange">
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="18" height="18">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
                {profile.credentialsHeading || 'Licenses & Credentials'}
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
            </div>

            {/* Client Reviews — placeholder */}
            <div className="rounded-2xl border border-[--line] bg-[--card] p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-brand-orange">
                  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="18" height="18">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  Client Reviews
                </h2>
              </div>
              <div className="mt-4">
                <EmptySection label="reviews" />
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-80 lg:shrink-0">
            <div className="lg:sticky lg:top-24">
              <div className="rounded-2xl border border-[--line] bg-[--card] p-6">
                <h3 className="mb-5 text-sm font-bold uppercase tracking-wider text-brand-orange">Contact Information</h3>

                <div className="space-y-4">
                  {location && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Location</span>
                      <span className="mt-0.5 block text-sm text-[--fg]">{location}</span>
                    </div>
                  )}
                  {profile.firmName && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Firm</span>
                      <span className="mt-0.5 block text-sm text-[--fg]">{profile.firmName}</span>
                    </div>
                  )}
                  {profile.phone && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Phone</span>
                      <a href={`tel:${profile.phone}`} className="mt-0.5 block text-sm text-[--fg] hover:text-brand-orange transition">{profile.phone}</a>
                    </div>
                  )}
                  {profile.email && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Email</span>
                      <a href={`mailto:${profile.email}`} className="mt-0.5 block text-sm text-[--fg] hover:text-brand-orange transition">{profile.email}</a>
                    </div>
                  )}
                  {profile.availabilityText && (
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[--muted]">Availability</span>
                      <span className="mt-0.5 block text-sm text-[--fg]">{profile.availabilityText}</span>
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
                  {profile.email ? (
                    <a
                      href={`mailto:${profile.email}`}
                      className="block w-full rounded-xl bg-gradient-to-r from-brand-orange to-brand-amber py-3 text-center text-sm font-bold text-slate-950 transition hover:opacity-90"
                    >
                      Contact Now
                    </a>
                  ) : (
                    <button disabled className="block w-full cursor-not-allowed rounded-xl bg-white/10 py-3 text-center text-sm font-bold text-white/40">
                      Contact Now
                    </button>
                  )}
                  {profile.calBookingUrl ? (
                    <a
                      href={profile.calBookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full rounded-xl border border-[--line] py-3 text-center text-sm font-semibold text-[--fg] transition hover:bg-[--card]"
                    >
                      Schedule Consultation
                    </a>
                  ) : (
                    <button disabled className="block w-full cursor-not-allowed rounded-xl border border-white/10 py-3 text-center text-sm font-semibold text-white/30">
                      Schedule Consultation
                    </button>
                  )}
                  {profile.website && (
                    <a
                      href={profile.website}
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
