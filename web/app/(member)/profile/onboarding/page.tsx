'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  User,
  Phone,
  Wrench,
  Users,
  FileText,
  Camera,
  CheckCircle2,
  Check,
  Clock,
  Lock,
  ChevronDown,
  Save,
  Loader2,
} from 'lucide-react'
import {
  Label,
  TextInput,
  Select,
  TextArea,
  Field,
  Grid2,
  Checkbox,
} from '../../client-pool/[clientId]/compliance/components/FormPrimitives'
import { getDashboard } from '@/lib/api/dashboard'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

/* ── canonical enums from vlp.profile.public.v1 ──────────────────────── */

const PROFESSION_ENUM = ['Attorney', 'CPA', 'Enrolled Actuary', 'Enrolled Agent', 'ERPA'] as const

const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware',
  'Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky',
  'Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi',
  'Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico',
  'New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania',
  'Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
  'Virginia','Washington','West Virginia','Wisconsin','Wyoming',
] as const

const SERVICES_ENUM = [
  'Appeals','Audit Defense','Business Tax Advisory','Compliance','Consulting',
  'Estate & Trust Tax','Expert Witness','Foreign Reporting (FBAR/FATCA)',
  'IRS Collections Defense','Offer in Compromise','Payroll Tax Defense',
  'Penalty Abatement','Tax Litigation','Tax Monitoring','Tax Planning',
  'Tax Preparation','Tax Resolution','Trust Fund Recovery Defense',
] as const

const SERVICE_ICON_MAP: Record<string, string> = {
  'Appeals': 'gavel',
  'Audit Defense': 'shield-check',
  'Business Tax Advisory': 'briefcase',
  'Compliance': 'file-check',
  'Consulting': 'users',
  'Estate & Trust Tax': 'scale-3',
  'Expert Witness': 'gavel',
  'Foreign Reporting (FBAR/FATCA)': 'globe',
  'IRS Collections Defense': 'shield-check',
  'Offer in Compromise': 'file-check',
  'Payroll Tax Defense': 'calculator',
  'Penalty Abatement': 'target',
  'Tax Litigation': 'gavel',
  'Tax Monitoring': 'target',
  'Tax Planning': 'book-open',
  'Tax Preparation': 'calculator',
  'Tax Resolution': 'shield-check',
  'Trust Fund Recovery Defense': 'shield-check',
}

const CLIENT_TYPES_ENUM = [
  'Businesses','C Corporations','Executives','Individuals',
  'LLCs','Nonprofits','Partnerships','S Corporations',
] as const

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] as const

/* ── nested profile type (subset we write from onboarding) ────────────── */

type ServiceItem = { title: string; description: string; icon: string }
type WeeklyAvailabilityDay = {
  day: typeof DAYS[number]
  enabled: boolean
  start_time: string | null
  end_time: string | null
}

type OnboardingState = {
  profile: {
    name: string
    status: 'featured' | 'hidden' | 'standard'
    avatar: { upload_type: 'firm_logo' | 'initials_only' | 'profile_photo' }
  }
  professional: { profession: string[]; years_experience: number; firm_name: string | null }
  contact: {
    contact_email: string | null
    phone: string | null
    languages: string[]
    weekly_availability: WeeklyAvailabilityDay[]
    availability_display: string | null
  }
  location: { city: string; state: string; country: string }
  services_offered: { items: ServiceItem[] }
  specializations: { client_types: string[] }
  bio: { bio_short: string; bio_full_paragraphs: string[] }
}

const EMPTY_STATE: OnboardingState = {
  profile: { name: '', status: 'standard', avatar: { upload_type: 'initials_only' } },
  professional: { profession: [], years_experience: 0, firm_name: null },
  contact: {
    contact_email: null,
    phone: null,
    languages: [],
    weekly_availability: DAYS.map((d) => ({
      day: d,
      enabled: d !== 'Saturday' && d !== 'Sunday',
      start_time: '09:00',
      end_time: '18:00',
    })),
    availability_display: null,
  },
  location: { city: '', state: '', country: 'United States' },
  services_offered: { items: [] },
  specializations: { client_types: [] },
  bio: { bio_short: '', bio_full_paragraphs: [] },
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length < 4) return `(${digits}`
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function deriveAvailabilityDisplay(days: WeeklyAvailabilityDay[]): string {
  const active = days.filter((d) => d.enabled)
  if (active.length === 0) return ''
  const abbr: Record<string, string> = {
    Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
    Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
  }
  const daysLabel =
    active.length === 1
      ? abbr[active[0].day]
      : `${abbr[active[0].day]}-${abbr[active[active.length - 1].day]}`
  const formatTime = (t: string | null) => {
    if (!t) return ''
    const [hh, mm] = t.split(':').map(Number)
    const period = hh >= 12 ? 'PM' : 'AM'
    const h12 = hh % 12 || 12
    return mm ? `${h12}:${String(mm).padStart(2, '0')}${period}` : `${h12}${period}`
  }
  const start = formatTime(active[0].start_time)
  const end = formatTime(active[0].end_time)
  return start && end ? `${daysLabel}, ${start}-${end}` : daysLabel
}

/* ── step meta ────────────────────────────────────────────────────────── */

type StepKey = 'basic' | 'contact' | 'services' | 'clients' | 'bio' | 'avatar' | 'publish'

const STEP_META: { key: StepKey; icon: React.ElementType; title: string; description: string }[] = [
  { key: 'basic',    icon: User,         title: 'Basic Information',      description: 'profile.name, professional.profession, professional.years_experience' },
  { key: 'contact',  icon: Phone,        title: 'Contact & Availability',  description: 'contact.*, location.*' },
  { key: 'services', icon: Wrench,       title: 'Services Offered',        description: 'services_offered.items[]' },
  { key: 'clients',  icon: Users,        title: 'Client Types',            description: 'specializations.client_types' },
  { key: 'bio',      icon: FileText,     title: 'Bio & Description',       description: 'bio.bio_short, bio.bio_full_paragraphs' },
  { key: 'avatar',   icon: Camera,       title: 'Profile Photo / Avatar',  description: 'profile.avatar' },
  { key: 'publish',  icon: CheckCircle2, title: 'Review & Publish',        description: 'Validates all sections → sets profile.status' },
]

/* ── page ─────────────────────────────────────────────────────────────── */

export default function OnboardingPage() {
  const [state, setState] = useState<OnboardingState>(EMPTY_STATE)
  const [professionalId, setProfessionalId] = useState<string | null>(null)
  const [accountName, setAccountName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openStep, setOpenStep] = useState<StepKey | null>('basic')
  const [savingStep, setSavingStep] = useState<StepKey | null>(null)
  const [stepMessage, setStepMessage] = useState<Partial<Record<StepKey, { ok: boolean; text: string }>>>({})

  // Load dashboard to resolve professional_id + pre-fill name
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dashboard = await getDashboard()
        if (cancelled) return
        setProfessionalId(dashboard.account.professional_id ?? null)
        setAccountName(dashboard.account.name || '')
        setState((s) => ({
          ...s,
          profile: { ...s.profile, name: dashboard.account.name || s.profile.name },
          contact: { ...s.contact, contact_email: dashboard.account.email || s.contact.contact_email },
        }))

        // If the account already has a profile, fetch its nested body so the
        // user can continue where they left off.
        if (dashboard.account.professional_id) {
          const res = await fetch(`${API_URL}/v1/profiles/${dashboard.account.professional_id}`, {
            credentials: 'include',
            cache: 'no-store',
          })
          if (res.ok) {
            const body = await res.json()
            const p = body?.profile
            if (!cancelled && p && p.profile) {
              setState((s) => hydrateState(s, p))
            }
          }
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const completedSteps = useMemo(() => computeCompleted(state), [state])
  const completedCount = Object.values(completedSteps).filter(Boolean).length

  async function saveStep(step: StepKey, patch: Record<string, unknown>) {
    setSavingStep(step)
    setStepMessage((m) => ({ ...m, [step]: undefined }))
    try {
      // First save — if no professional_id yet, POST creates the profile.
      if (!professionalId) {
        const res = await fetch(`${API_URL}/v1/profiles`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok || !body?.ok) throw new Error(body?.message || `POST failed (${res.status})`)
        setProfessionalId(body.professional_id)
        setStepMessage((m) => ({ ...m, [step]: { ok: true, text: 'Saved' } }))
        return
      }
      // Subsequent saves — PATCH merges.
      const res = await fetch(`${API_URL}/v1/profiles/${professionalId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) throw new Error(body?.message || `PATCH failed (${res.status})`)
      setStepMessage((m) => ({ ...m, [step]: { ok: true, text: 'Saved' } }))
    } catch (err) {
      setStepMessage((m) => ({ ...m, [step]: { ok: false, text: err instanceof Error ? err.message : 'Save failed' } }))
    } finally {
      setSavingStep(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-white/40">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading profile…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <a
          href="/profile"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-white/40 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Profile
        </a>
        <h1 className="text-2xl font-semibold text-white">Profile Onboarding</h1>
        <p className="mt-1 text-sm text-white/50">
          {accountName ? `Welcome, ${accountName}. ` : ''}Complete your profile to appear in the directory.
        </p>
        {loadError && (
          <p className="mt-2 text-xs text-red-400">{loadError}</p>
        )}
      </div>

      {/* Progress summary */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Setup Progress</h3>
          <span className="text-sm font-semibold text-brand-orange">
            {completedCount} of {STEP_META.length} steps
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-orange to-brand-amber transition-all"
            style={{ width: `${Math.round((completedCount / STEP_META.length) * 100)}%` }}
          />
        </div>
      </div>

      {/* Onboarding steps */}
      <div className="space-y-3">
        {STEP_META.map((meta, i) => {
          const isComplete = completedSteps[meta.key]
          const isOpen = openStep === meta.key
          const StepIcon = meta.icon
          const statusCfg = isComplete
            ? { badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'Complete', Icon: Check }
            : meta.key === 'publish' && completedCount < STEP_META.length - 1
              ? { badge: 'bg-white/5 text-white/30 border-white/10', label: 'Locked', Icon: Lock }
              : { badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20', label: 'Pending', Icon: Clock }

          const locked = meta.key === 'publish' && completedCount < STEP_META.length - 1

          return (
            <div
              key={meta.key}
              className={`rounded-xl border ${
                locked ? 'border-white/5 bg-white/[0.02] opacity-60' : 'border-[--member-border] bg-[--member-card]'
              }`}
            >
              <button
                onClick={() => !locked && setOpenStep(isOpen ? null : meta.key)}
                className="flex w-full items-start gap-4 p-5 text-left"
                disabled={locked}
              >
                <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                  isComplete ? 'bg-emerald-500/10' : 'bg-brand-orange/10'
                }`}>
                  <StepIcon className={`h-5 w-5 ${isComplete ? 'text-emerald-400' : 'text-brand-orange'}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">
                    Step {i + 1} — {meta.title}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-brand-orange/60">
                    {meta.description}
                  </p>
                </div>
                <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusCfg.badge}`}>
                  <statusCfg.Icon className="h-3 w-3" />
                  {statusCfg.label}
                </span>
                <ChevronDown
                  className={`ml-2 h-4 w-4 shrink-0 text-white/40 transition ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isOpen && !locked && (
                <div className="border-t border-white/10 p-6">
                  {renderStepForm(meta.key, state, setState, (patch) => saveStep(meta.key, patch), savingStep === meta.key, stepMessage[meta.key])}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── hydrate state from a server profile ──────────────────────────────── */

function hydrateState(base: OnboardingState, p: any): OnboardingState {
  return {
    profile: {
      name: p?.profile?.name ?? base.profile.name,
      status: p?.profile?.status ?? base.profile.status,
      avatar: { upload_type: p?.profile?.avatar?.upload_type ?? base.profile.avatar.upload_type },
    },
    professional: {
      profession: p?.professional?.profession ?? base.professional.profession,
      years_experience: p?.professional?.years_experience ?? base.professional.years_experience,
      firm_name: p?.professional?.firm_name ?? base.professional.firm_name,
    },
    contact: {
      contact_email: p?.contact?.contact_email ?? base.contact.contact_email,
      phone: p?.contact?.phone ?? base.contact.phone,
      languages: p?.contact?.languages ?? base.contact.languages,
      weekly_availability: Array.isArray(p?.contact?.weekly_availability) && p.contact.weekly_availability.length > 0
        ? p.contact.weekly_availability
        : base.contact.weekly_availability,
      availability_display: p?.contact?.availability_display ?? base.contact.availability_display,
    },
    location: {
      city: p?.location?.city ?? base.location.city,
      state: p?.location?.state ?? base.location.state,
      country: p?.location?.country ?? base.location.country,
    },
    services_offered: {
      items: Array.isArray(p?.services_offered?.items) ? p.services_offered.items : base.services_offered.items,
    },
    specializations: {
      client_types: p?.specializations?.client_types ?? base.specializations.client_types,
    },
    bio: {
      bio_short: p?.bio?.bio_short ?? base.bio.bio_short,
      bio_full_paragraphs: p?.bio?.bio_full_paragraphs ?? base.bio.bio_full_paragraphs,
    },
  }
}

function computeCompleted(s: OnboardingState): Record<StepKey, boolean> {
  return {
    basic: !!s.profile.name && s.professional.profession.length > 0 && s.professional.years_experience >= 0,
    contact: !!(s.contact.contact_email && s.contact.phone && s.location.city && s.location.state),
    services: s.services_offered.items.length > 0,
    clients: s.specializations.client_types.length > 0,
    bio: !!s.bio.bio_short && s.bio.bio_full_paragraphs.length > 0,
    avatar: true, // Step 6 is always "complete" — uploads are future work
    publish: s.profile.status !== 'hidden' && !!s.profile.name && s.services_offered.items.length > 0,
  }
}

/* ── step forms ───────────────────────────────────────────────────────── */

function renderStepForm(
  step: StepKey,
  state: OnboardingState,
  setState: React.Dispatch<React.SetStateAction<OnboardingState>>,
  save: (patch: Record<string, unknown>) => void,
  saving: boolean,
  message: { ok: boolean; text: string } | undefined
) {
  switch (step) {
    case 'basic':    return <BasicStep state={state} setState={setState} save={save} saving={saving} message={message} />
    case 'contact':  return <ContactStep state={state} setState={setState} save={save} saving={saving} message={message} />
    case 'services': return <ServicesStep state={state} setState={setState} save={save} saving={saving} message={message} />
    case 'clients':  return <ClientTypesStep state={state} setState={setState} save={save} saving={saving} message={message} />
    case 'bio':      return <BioStep state={state} setState={setState} save={save} saving={saving} message={message} />
    case 'avatar':   return <AvatarStep state={state} setState={setState} save={save} saving={saving} message={message} />
    case 'publish':  return <PublishStep state={state} save={save} saving={saving} message={message} />
  }
}

type StepFormProps = {
  state: OnboardingState
  setState: React.Dispatch<React.SetStateAction<OnboardingState>>
  save: (patch: Record<string, unknown>) => void
  saving: boolean
  message: { ok: boolean; text: string } | undefined
}

function SaveBar({ saving, message, onSave }: { saving: boolean; message?: { ok: boolean; text: string }; onSave: () => void }) {
  return (
    <div className="mt-6 flex items-center gap-3">
      <button
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-orange/90 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save
      </button>
      {message && (
        <span className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </span>
      )}
    </div>
  )
}

function BasicStep({ state, setState, save, saving, message }: StepFormProps) {
  const toggleProfession = (p: string) => {
    setState((s) => {
      const has = s.professional.profession.includes(p)
      return {
        ...s,
        professional: {
          ...s.professional,
          profession: has ? s.professional.profession.filter((x) => x !== p) : [...s.professional.profession, p],
        },
      }
    })
  }
  return (
    <div className="space-y-5">
      <Grid2>
        <Field label="Display Name">
          <TextInput
            value={state.profile.name}
            onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, name: e.target.value } }))}
            placeholder="Jane Smith, CPA"
          />
        </Field>
        <Field label="Years of Experience">
          <TextInput
            type="number"
            min={0}
            max={80}
            value={state.professional.years_experience}
            onChange={(e) => setState((s) => ({ ...s, professional: { ...s.professional, years_experience: Number(e.target.value) || 0 } }))}
          />
        </Field>
      </Grid2>

      <div>
        <Label>Profession (select all that apply)</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {PROFESSION_ENUM.map((p) => (
            <Checkbox
              key={p}
              checked={state.professional.profession.includes(p)}
              onChange={() => toggleProfession(p)}
              label={p}
            />
          ))}
        </div>
      </div>

      <Field label="Firm Name (optional)">
        <TextInput
          value={state.professional.firm_name ?? ''}
          onChange={(e) => setState((s) => ({ ...s, professional: { ...s.professional, firm_name: e.target.value || null } }))}
          placeholder="Smith & Co. Tax Advisors"
        />
      </Field>

      <SaveBar saving={saving} message={message} onSave={() => save({
        profile: { name: state.profile.name },
        professional: {
          profession: state.professional.profession,
          years_experience: state.professional.years_experience,
          firm_name: state.professional.firm_name,
        },
      })} />
    </div>
  )
}

function ContactStep({ state, setState, save, saving, message }: StepFormProps) {
  const toggleDay = (day: string) => {
    setState((s) => ({
      ...s,
      contact: {
        ...s.contact,
        weekly_availability: s.contact.weekly_availability.map((d) =>
          d.day === day ? { ...d, enabled: !d.enabled } : d
        ),
      },
    }))
  }
  const setDayTime = (day: string, field: 'start_time' | 'end_time', value: string) => {
    setState((s) => ({
      ...s,
      contact: {
        ...s.contact,
        weekly_availability: s.contact.weekly_availability.map((d) =>
          d.day === day ? { ...d, [field]: value } : d
        ),
      },
    }))
  }
  const availabilityPreview = deriveAvailabilityDisplay(state.contact.weekly_availability)

  return (
    <div className="space-y-5">
      <Grid2>
        <Field label="Contact Email">
          <TextInput
            type="email"
            value={state.contact.contact_email ?? ''}
            onChange={(e) => setState((s) => ({ ...s, contact: { ...s.contact, contact_email: e.target.value || null } }))}
            placeholder="you@firm.com"
          />
        </Field>
        <Field label="Phone">
          <TextInput
            type="tel"
            value={state.contact.phone ?? ''}
            onChange={(e) => setState((s) => ({ ...s, contact: { ...s.contact, phone: e.target.value || null } }))}
            onBlur={(e) => setState((s) => ({ ...s, contact: { ...s.contact, phone: formatPhone(e.target.value) } }))}
            placeholder="(555) 123-4567"
          />
        </Field>
      </Grid2>

      <Grid2>
        <Field label="City">
          <TextInput
            value={state.location.city}
            onChange={(e) => setState((s) => ({ ...s, location: { ...s.location, city: e.target.value } }))}
            placeholder="Austin"
          />
        </Field>
        <Field label="State">
          <Select
            value={state.location.state}
            onChange={(e) => setState((s) => ({ ...s, location: { ...s.location, state: e.target.value } }))}
            options={US_STATES}
            placeholder="Select state..."
          />
        </Field>
      </Grid2>

      <Field label="Country">
        <TextInput
          value={state.location.country}
          onChange={(e) => setState((s) => ({ ...s, location: { ...s.location, country: e.target.value } }))}
        />
      </Field>

      {/* Weekly availability */}
      <div>
        <Label>Weekly Availability</Label>
        <div className="space-y-2">
          {state.contact.weekly_availability.map((d) => (
            <div key={d.day} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
              <button
                type="button"
                onClick={() => toggleDay(d.day)}
                className={`w-24 rounded px-3 py-1.5 text-xs font-medium transition ${
                  d.enabled
                    ? 'bg-brand-orange/20 text-brand-orange border border-brand-orange/40'
                    : 'bg-white/5 text-white/40 border border-white/10'
                }`}
              >
                {d.day}
              </button>
              {d.enabled && (
                <>
                  <input
                    type="time"
                    value={d.start_time ?? '09:00'}
                    onChange={(e) => setDayTime(d.day, 'start_time', e.target.value)}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-white [color-scheme:dark] focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  />
                  <span className="text-xs text-white/40">to</span>
                  <input
                    type="time"
                    value={d.end_time ?? '18:00'}
                    onChange={(e) => setDayTime(d.day, 'end_time', e.target.value)}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-white [color-scheme:dark] focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  />
                </>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/40">
          Derived display: <span className="text-brand-orange">{availabilityPreview || '—'}</span>
        </p>
      </div>

      <SaveBar saving={saving} message={message} onSave={() => save({
        contact: {
          contact_email: state.contact.contact_email,
          phone: state.contact.phone,
          weekly_availability: state.contact.weekly_availability,
          availability_display: null, // let the server re-derive
        },
        location: {
          city: state.location.city,
          state: state.location.state,
          country: state.location.country,
        },
      })} />
    </div>
  )
}

function ServicesStep({ state, setState, save, saving, message }: StepFormProps) {
  const toggleService = (title: string) => {
    setState((s) => {
      const has = s.services_offered.items.some((i) => i.title === title)
      if (has) {
        return {
          ...s,
          services_offered: { items: s.services_offered.items.filter((i) => i.title !== title) },
        }
      }
      return {
        ...s,
        services_offered: {
          items: [
            ...s.services_offered.items,
            { title, description: '', icon: SERVICE_ICON_MAP[title] || 'briefcase' },
          ],
        },
      }
    })
  }
  const setDescription = (title: string, description: string) => {
    setState((s) => ({
      ...s,
      services_offered: {
        items: s.services_offered.items.map((i) => (i.title === title ? { ...i, description } : i)),
      },
    }))
  }
  const selected = state.services_offered.items
  return (
    <div className="space-y-5">
      <div>
        <Label>Services Offered (select all that apply — up to 16)</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES_ENUM.map((svc) => (
            <Checkbox
              key={svc}
              checked={selected.some((i) => i.title === svc)}
              onChange={() => toggleService(svc)}
              label={svc}
            />
          ))}
        </div>
      </div>

      {selected.length > 0 && (
        <div>
          <Label>Optional descriptions for selected services</Label>
          <div className="space-y-3">
            {selected.map((item) => (
              <div key={item.title}>
                <p className="mb-1 text-xs text-white/60">{item.title}</p>
                <TextArea
                  rows={2}
                  value={item.description}
                  onChange={(e) => setDescription(item.title, e.target.value)}
                  placeholder={`How you help clients with ${item.title.toLowerCase()}...`}
                  maxLength={220}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <SaveBar saving={saving} message={message} onSave={() => save({
        services_offered: { items: state.services_offered.items },
      })} />
    </div>
  )
}

function ClientTypesStep({ state, setState, save, saving, message }: StepFormProps) {
  const toggle = (t: string) => {
    setState((s) => {
      const has = s.specializations.client_types.includes(t)
      return {
        ...s,
        specializations: {
          client_types: has ? s.specializations.client_types.filter((x) => x !== t) : [...s.specializations.client_types, t],
        },
      }
    })
  }
  return (
    <div className="space-y-5">
      <div>
        <Label>Client Types (select all that apply)</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CLIENT_TYPES_ENUM.map((t) => (
            <Checkbox
              key={t}
              checked={state.specializations.client_types.includes(t)}
              onChange={() => toggle(t)}
              label={t}
            />
          ))}
        </div>
      </div>
      <SaveBar saving={saving} message={message} onSave={() => save({
        specializations: { client_types: state.specializations.client_types },
      })} />
    </div>
  )
}

function BioStep({ state, setState, save, saving, message }: StepFormProps) {
  const shortLength = state.bio.bio_short.length
  const fullText = state.bio.bio_full_paragraphs.join('\n\n')
  return (
    <div className="space-y-5">
      <Field label={`Short Bio (${shortLength} / 220 chars)`}>
        <TextArea
          rows={3}
          maxLength={220}
          value={state.bio.bio_short}
          onChange={(e) => setState((s) => ({ ...s, bio: { ...s.bio, bio_short: e.target.value } }))}
          placeholder="One or two sentences for your directory card."
        />
      </Field>
      <Field label="Full Bio (separate paragraphs with a blank line)">
        <TextArea
          rows={8}
          value={fullText}
          onChange={(e) => {
            const paragraphs = e.target.value.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
            setState((s) => ({ ...s, bio: { ...s.bio, bio_full_paragraphs: paragraphs.length ? paragraphs : [e.target.value] } }))
          }}
          placeholder="Tell visitors about your background, approach, and how you help clients..."
        />
      </Field>
      <SaveBar saving={saving} message={message} onSave={() => save({
        bio: {
          bio_short: state.bio.bio_short,
          bio_full_paragraphs: state.bio.bio_full_paragraphs,
        },
      })} />
    </div>
  )
}

function AvatarStep({ state, setState, save, saving, message }: StepFormProps) {
  return (
    <div className="space-y-5">
      <div>
        <Label>Avatar Type</Label>
        <Select
          value={state.profile.avatar.upload_type}
          onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, avatar: { upload_type: e.target.value as OnboardingState['profile']['avatar']['upload_type'] } } }))}
          options={[
            { value: 'initials_only', label: 'Use initials only' },
            { value: 'profile_photo', label: 'Profile photo (upload coming soon)' },
            { value: 'firm_logo', label: 'Firm logo (upload coming soon)' },
          ]}
          placeholder="Select avatar type..."
        />
      </div>
      <p className="text-xs text-white/40">
        File upload is a future enhancement. For now, the directory will show your initials ({state.profile.name.split(/\s+/).map((p) => p[0]?.toUpperCase()).slice(0, 2).join('')}) in a styled avatar circle.
      </p>
      <SaveBar saving={saving} message={message} onSave={() => save({
        profile: { avatar: { upload_type: state.profile.avatar.upload_type } },
      })} />
    </div>
  )
}

function PublishStep({ state, save, saving, message }: { state: OnboardingState; save: (patch: Record<string, unknown>) => void; saving: boolean; message: { ok: boolean; text: string } | undefined }) {
  const activeDays = state.contact.weekly_availability.filter((d) => d.enabled).map((d) => d.day).join(', ')
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">Review</h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <SummaryRow label="Name" value={state.profile.name || '—'} />
          <SummaryRow label="Profession" value={state.professional.profession.join(', ') || '—'} />
          <SummaryRow label="Years Experience" value={String(state.professional.years_experience || '—')} />
          <SummaryRow label="Firm" value={state.professional.firm_name || '—'} />
          <SummaryRow label="Email" value={state.contact.contact_email || '—'} />
          <SummaryRow label="Phone" value={state.contact.phone || '—'} />
          <SummaryRow label="Location" value={[state.location.city, state.location.state].filter(Boolean).join(', ') || '—'} />
          <SummaryRow label="Availability" value={activeDays || '—'} />
          <SummaryRow label="Services" value={state.services_offered.items.map((i) => i.title).join(', ') || '—'} span={2} />
          <SummaryRow label="Client Types" value={state.specializations.client_types.join(', ') || '—'} span={2} />
          <SummaryRow label="Short Bio" value={state.bio.bio_short || '—'} span={2} />
          <SummaryRow label="Full Bio" value={`${state.bio.bio_full_paragraphs.length} paragraph${state.bio.bio_full_paragraphs.length === 1 ? '' : 's'}`} span={2} />
        </dl>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => save({ profile: { status: 'standard' } })}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-orange/90 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Publish Profile
        </button>
        {message && (
          <span className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ label, value, span = 1 }: { label: string; value: string; span?: 1 | 2 }) {
  return (
    <div className={span === 2 ? 'sm:col-span-2' : ''}>
      <dt className="text-[11px] uppercase tracking-wide text-white/40">{label}</dt>
      <dd className="mt-0.5 text-white/90">{value}</dd>
    </div>
  )
}
