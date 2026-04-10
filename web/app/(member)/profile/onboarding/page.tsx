import type { Metadata } from 'next'
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
} from 'lucide-react'

export const metadata: Metadata = { title: 'Onboarding' }

/* ── 18-service enum from vlp.profile.public.v1 ──────────────────── */

const SERVICES_ENUM = [
  'Appeals',
  'Audit Defense',
  'Business Tax Advisory',
  'Compliance',
  'Consulting',
  'Estate & Trust Tax',
  'Expert Witness',
  'Foreign Reporting (FBAR/FATCA)',
  'IRS Collections Defense',
  'Offer in Compromise',
  'Payroll Tax Defense',
  'Penalty Abatement',
  'Tax Litigation',
  'Tax Monitoring',
  'Tax Planning',
  'Tax Preparation',
  'Tax Resolution',
  'Trust Fund Recovery Defense',
]

/* ── 8-client-type enum from vlp.profile.public.v1 ───────────────── */

const CLIENT_TYPES_ENUM = [
  'Businesses',
  'C Corporations',
  'Executives',
  'Individuals',
  'LLCs',
  'Nonprofits',
  'Partnerships',
  'S Corporations',
]

/* ── onboarding steps mapped to nested profile sections ───────────── */

const steps = [
  {
    icon: User,
    title: 'Basic Information',
    description: 'profile.name, professional.profession, professional.years_experience',
    hint: 'Your display name, profession (Attorney, CPA, EA, ERPA, Enrolled Actuary), and years of experience.',
    status: 'complete' as const,
  },
  {
    icon: Phone,
    title: 'Contact Details',
    description: 'contact.contact_email, contact.phone, location.*',
    hint: 'Email, phone, city, state, country, and zip code for your public listing.',
    status: 'complete' as const,
  },
  {
    icon: Wrench,
    title: 'Services Offered',
    description: `services_offered.items[] — ${SERVICES_ENUM.length} service categories`,
    hint: `Select from: ${SERVICES_ENUM.join(', ')}.`,
    status: 'complete' as const,
  },
  {
    icon: Users,
    title: 'Client Types',
    description: `specializations.client_types — ${CLIENT_TYPES_ENUM.length} client categories`,
    hint: `Choose from: ${CLIENT_TYPES_ENUM.join(', ')}.`,
    status: 'complete' as const,
  },
  {
    icon: FileText,
    title: 'Bio & Description',
    description: 'bio.bio_short, bio.bio_full_paragraphs',
    hint: 'A short tagline (max 220 chars) plus up to 6 full-length paragraphs for your public bio.',
    status: 'complete' as const,
  },
  {
    icon: Camera,
    title: 'Profile Photo / Avatar',
    description: 'profile.avatar',
    hint: 'Upload a professional headshot or use initials. Supported: JPG, PNG, WebP, SVG (128–2000px).',
    status: 'pending' as const,
  },
  {
    icon: CheckCircle2,
    title: 'Review & Publish',
    description: 'Validates all sections → sets profile.status',
    hint: 'Review every section, then publish your profile to the directory (status: standard or featured).',
    status: 'locked' as const,
  },
]

const statusConfig = {
  complete: {
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    label: 'Complete',
    icon: Check,
  },
  pending: {
    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    label: 'Pending',
    icon: Clock,
  },
  locked: {
    badge: 'bg-white/5 text-white/30 border-white/10',
    label: 'Locked',
    icon: Lock,
  },
}

/* ── page ──────────────────────────────────────────────────────────── */

export default function OnboardingPage() {
  const completedCount = steps.filter((s) => s.status === 'complete').length

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
          Complete your profile setup to appear in the directory.
        </p>
      </div>

      {/* Progress summary */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Setup Progress</h3>
          <span className="text-sm font-semibold text-brand-orange">
            {completedCount} of {steps.length} steps
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-orange to-brand-amber transition-all"
            style={{ width: `${Math.round((completedCount / steps.length) * 100)}%` }}
          />
        </div>
      </div>

      {/* Onboarding checklist */}
      <div className="space-y-3">
        {steps.map((step, i) => {
          const cfg = statusConfig[step.status]
          const StepIcon = step.icon
          const StatusIcon = cfg.icon

          return (
            <button
              key={i}
              className={`flex w-full items-start gap-4 rounded-xl border p-5 text-left transition ${
                step.status === 'locked'
                  ? 'cursor-not-allowed border-white/5 bg-white/[0.02] opacity-50'
                  : 'border-[--member-border] bg-[--member-card] hover:bg-[--member-card-hover]'
              }`}
              disabled={step.status === 'locked'}
            >
              <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                step.status === 'complete'
                  ? 'bg-emerald-500/10'
                  : step.status === 'pending'
                    ? 'bg-brand-orange/10'
                    : 'bg-white/5'
              }`}>
                <StepIcon className={`h-5 w-5 ${
                  step.status === 'complete'
                    ? 'text-emerald-400'
                    : step.status === 'pending'
                      ? 'text-brand-orange'
                      : 'text-white/20'
                }`} />
              </div>

              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${
                  step.status === 'locked' ? 'text-white/30' : 'text-white'
                }`}>
                  {step.title}
                </p>
                <p className={`mt-0.5 font-mono text-[11px] ${
                  step.status === 'locked' ? 'text-white/15' : 'text-brand-orange/60'
                }`}>
                  {step.description}
                </p>
                <p className={`mt-1 text-xs ${
                  step.status === 'locked' ? 'text-white/20' : 'text-white/40'
                }`}>
                  {step.hint}
                </p>
              </div>

              <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cfg.badge}`}>
                <StatusIcon className="h-3 w-3" />
                {cfg.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
