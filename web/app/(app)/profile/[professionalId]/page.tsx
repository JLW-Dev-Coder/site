'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

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
}

export default function ProfileViewPage() {
  const params = useParams()
  const professionalId = params.professionalId as string
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const isOwner = typeof window !== 'undefined' && localStorage.getItem('vlp_professional_id') === professionalId
  const profileUrl = `https://virtuallaunch.pro/profile/${professionalId}`

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`https://api.virtuallaunch.pro/v1/profiles/public/${professionalId}`)
        if (!res.ok) { setError('Profile not found.'); return }
        const data = await res.json()
        setProfile(data.profile)
      } catch {
        setError('Failed to load profile.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [professionalId])

  const handleCopy = () => {
    navigator.clipboard.writeText(profileUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-slate-400">Loading...</div>
  if (error || !profile) return <div className="flex items-center justify-center py-20 text-red-400">{error || 'Profile not found.'}</div>

  const additionalCreds = (profile.additionalCredentials || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return (
    <div className="mx-auto max-w-3xl py-8 px-4">
      {/* Hero */}
      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6">
        <div className="flex items-start gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-xl font-bold text-slate-950">
            {profile.initials || (profile.displayName || '?').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold text-white">{profile.displayName || profile.fullName}</div>
            {profile.bioShort && <div className="mt-1 text-sm text-slate-400">{profile.bioShort}</div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {(profile.city || profile.state) && (
                <span className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300">
                  {[profile.city, profile.state].filter(Boolean).join(', ')}
                </span>
              )}
              {profile.yearsExperience && (
                <span className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300">
                  {profile.yearsExperience} yrs experience
                </span>
              )}
              {(profile.professions || []).map((p) => (
                <span key={p} className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs text-orange-300">
                  {p === 'Other' && profile.otherProfession ? profile.otherProfession : p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      {profile.bio1 && (
        <div className="mt-4 rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6" style={{ borderLeft: '4px solid rgb(249,115,22)' }}>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-orange-400">{profile.aboutHeading || 'About Me'}</h3>
          <p className="text-sm text-slate-300 leading-relaxed">{profile.bio1}</p>
          {profile.bio2 && <p className="mt-3 text-sm text-slate-300 leading-relaxed">{profile.bio2}</p>}
          {profile.bio3 && <p className="mt-3 text-sm text-slate-300 leading-relaxed">{profile.bio3}</p>}
        </div>
      )}

      {/* Services */}
      {profile.primaryService && (
        <div className="mt-4 rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-orange-400">{profile.servicesHeading || 'Services'}</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-orange-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              <span className="text-sm font-semibold text-white">{profile.primaryService}</span>
            </div>
            {(profile.additionalServices || []).map((svc) => (
              <div key={svc} className="flex items-center gap-2 pl-1">
                <svg className="h-4 w-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-sm text-slate-300">{svc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Credentials */}
      {profile.primaryCredential && (
        <div className="mt-4 rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-orange-400">{profile.credentialsHeading || 'Credentials'}</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="text-sm font-semibold text-white">{profile.primaryCredential}</span>
            </div>
            {additionalCreds.map((cred) => (
              <div key={cred} className="flex items-center gap-2">
                <svg className="h-4 w-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-sm text-slate-300">{cred}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contact */}
      <div className="mt-4 rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-orange-400">Contact</h3>
        <dl className="space-y-2 text-sm">
          {profile.email && <div><dt className="text-xs text-slate-500">Email</dt><dd className="text-slate-300">{profile.email}</dd></div>}
          {profile.phone && <div><dt className="text-xs text-slate-500">Phone</dt><dd className="text-slate-300">{profile.phone}</dd></div>}
          {profile.firmName && <div><dt className="text-xs text-slate-500">Firm</dt><dd className="text-slate-300">{profile.firmName}</dd></div>}
          {(profile.languages || []).length > 0 && <div><dt className="text-xs text-slate-500">Languages</dt><dd className="text-slate-300">{(profile.languages || []).join(', ')}</dd></div>}
          {profile.availabilityText && <div><dt className="text-xs text-slate-500">Availability</dt><dd className="text-slate-300">{profile.availabilityText}</dd></div>}
        </dl>
        {profile.calBookingUrl && (
          <a
            href={profile.calBookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
          >
            Schedule a Call
          </a>
        )}
      </div>

      {/* Share My Profile (owner only) */}
      {isOwner && (
        <div className="mt-6 rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-orange-400">Share My Profile</h3>
          <div className="flex items-center gap-3">
            <input
              readOnly
              value={profileUrl}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
            />
            <button
              onClick={handleCopy}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 hover:from-orange-400 hover:to-amber-400'
              }`}
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
          <div className="mt-3 flex gap-3">
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(profileUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition"
            >
              LinkedIn
            </a>
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(profileUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition"
            >
              Facebook
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent(`Check out my profile on Virtual Launch Pro`)}&body=${encodeURIComponent(`View my professional profile: ${profileUrl}`)}`}
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition"
            >
              Email
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
