import type { Metadata } from 'next'
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  Globe,
  Mail,
  Phone,
  MapPin,
  Award,
  Briefcase,
  Clock,
  Check,
} from 'lucide-react'
import HeroCard from '../../components/HeroCard'

export const metadata: Metadata = { title: 'Profile Preview' }

/* ── page ──────────────────────────────────────────────────────── */

export default function ProfilePreviewPage() {
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
        <h1 className="text-2xl font-semibold text-white">Profile Preview</h1>
        <p className="mt-1 text-sm text-white/50">
          This is how your profile appears in the public directory.
        </p>
      </div>

      {/* Preview notice */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 border-l-4 border-l-blue-400 bg-blue-500/5 px-5 py-4">
        <Eye className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
        <div>
          <p className="text-sm font-medium text-blue-300">Preview Mode</p>
          <p className="mt-0.5 text-xs text-blue-300/70">
            This is a preview of your public directory listing. Changes made on your Profile page will be reflected here after saving.
          </p>
        </div>
      </div>

      {/* Profile card preview — nested shape: profile.*, professional.*, hero.*, bio.* */}
      <HeroCard>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          {/* Avatar — profile.avatar (initials_only fallback) */}
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-orange to-brand-amber text-2xl font-bold text-white">
            JW
          </div>

          {/* Info — hero.headline, hero.location_label, hero.years_experience_label, hero.credential_badges */}
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white">Jamie Williams</h2>
            <p className="mt-1 text-sm font-medium text-brand-orange">Enrolled Agent</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/40">
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                San Diego, CA
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                12+ Years Experience
              </span>
              <span className="flex items-center gap-1">
                <Award className="h-3 w-3" />
                EA
              </span>
            </div>
            {/* bio.bio_short */}
            <p className="mt-4 text-sm leading-relaxed text-white/60">
              Experienced Enrolled Agent specializing in IRS representation, tax resolution, and compliance. Helping individuals and businesses navigate complex tax situations for over 12 years.
            </p>
          </div>
        </div>
      </HeroCard>

      {/* Details grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Services — services_offered.items[] */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Services Offered</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {['IRS Collections Defense', 'Tax Resolution', 'Tax Preparation', 'Audit Defense', 'Penalty Abatement', 'Tax Planning'].map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full border border-brand-orange/20 bg-brand-orange/5 px-3 py-1 text-xs font-medium text-brand-orange">
                <Check className="h-3 w-3" />
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Contact — contact.contact_email, contact.phone, contact.website, professional.firm_name */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Contact Information</h3>
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Mail className="h-4 w-4 text-white/30" />
              jamie.williams@virtuallaunch.pro
            </div>
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Phone className="h-4 w-4 text-white/30" />
              (619) 555-0142
            </div>
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Globe className="h-4 w-4 text-white/30" />
              virtuallaunch.pro
            </div>
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Briefcase className="h-4 w-4 text-white/30" />
              Williams Tax Advisory
            </div>
          </div>
        </div>
      </div>

      {/* View live profile link — links to /profile/[professional_id] */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6 text-center">
        <p className="text-sm text-white/50">
          Your public profile is live and visible to potential clients in the VLP directory.
        </p>
        <a
          href="/profile/pro-jamie-l-williams-ea-edl3nv"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90"
        >
          View Live Public Profile
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}
