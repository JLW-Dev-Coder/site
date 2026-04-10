import type { Metadata } from 'next'
import {
  User,
  Award,
  Clock,
  Briefcase,
  Mail,
  Phone,
  Globe,
  Building2,
  MapPin,
  FileCheck,
  Pencil,
  Camera,
  BadgeCheck,
  ExternalLink,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'

export const metadata: Metadata = { title: 'Profile' }

/* ── page ──────────────────────────────────────────────────────── */

export default function ProfilePage() {
  const completeness = 92

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Profile</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage your professional profile and credentials.
        </p>
      </div>

      {/* Profile Completeness */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Profile Completeness</h3>
          <span className="text-sm font-semibold text-brand-orange">{completeness}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-orange to-brand-amber transition-all"
            style={{ width: `${completeness}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-white/40">
          Add a profile photo and verify your license number to reach 100%.
        </p>
      </div>

      {/* Row 1: Professional Details + Public Profile Preview */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Professional Details */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Professional Details</h3>
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <User className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Full Name</p>
                <p className="text-sm font-medium text-white">Jamie Williams, EA</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Award className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Credentials</p>
                <p className="text-sm font-medium text-white">Enrolled Agent (EA)</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Clock className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Years of Experience</p>
                <p className="text-sm font-medium text-white">12 years</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Briefcase className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Specialization</p>
                <p className="text-sm font-medium text-white">IRS Representation & Tax Resolution</p>
              </div>
            </div>
          </div>
        </div>

        {/* Public Profile Preview */}
        <HeroCard>
          <h3 className="text-xs uppercase tracking-widest text-brand-orange/70">Public Profile Preview</h3>
          <div className="mt-5 flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-orange to-brand-amber text-xl font-bold text-white">
              JW
            </div>
            <div>
              <p className="text-lg font-semibold text-white">Jamie Williams</p>
              <p className="text-sm text-brand-orange">Enrolled Agent</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Experienced Enrolled Agent specializing in IRS representation, tax resolution, and compliance. Helping individuals and businesses navigate complex tax situations for over 12 years.
          </p>
          <a
            href="/profile/preview"
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange transition hover:text-brand-amber"
          >
            View Public Profile
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </HeroCard>
      </div>

      {/* Row 2: Contact Information + Business Information */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Contact Information */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Contact Information</h3>
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Mail className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Email</p>
                <p className="text-sm font-medium text-white">jamie.williams@virtuallaunch.pro</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Phone className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Phone</p>
                <p className="text-sm font-medium text-white">(619) 555-0142</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Globe className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Website</p>
                <p className="text-sm font-medium text-brand-orange">virtuallaunch.pro/profile/jamie-williams</p>
              </div>
            </div>
          </div>
        </div>

        {/* Business Information */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Business Information</h3>
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Building2 className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Business Name</p>
                <p className="text-sm font-medium text-white">Williams Tax Advisory</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <MapPin className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Location</p>
                <p className="text-sm font-medium text-white">San Diego, CA</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <FileCheck className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">License #</p>
                <p className="text-sm font-medium text-white/40">Not verified</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Profile Sections */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Edit Profile Sections</h3>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <button className="flex items-center gap-3 rounded-xl border border-[--member-border] p-4 transition hover:bg-[--member-card-hover]">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
              <Pencil className="h-4 w-4 text-brand-orange" />
            </div>
            <span className="text-sm font-medium text-white">Edit Profile</span>
          </button>
          <button className="flex items-center gap-3 rounded-xl border border-[--member-border] p-4 transition hover:bg-[--member-card-hover]">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
              <Camera className="h-4 w-4 text-brand-orange" />
            </div>
            <span className="text-sm font-medium text-white">Add Photo</span>
          </button>
          <button className="flex items-center gap-3 rounded-xl border border-[--member-border] p-4 transition hover:bg-[--member-card-hover]">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
              <BadgeCheck className="h-4 w-4 text-brand-orange" />
            </div>
            <span className="text-sm font-medium text-white">Edit Credentials</span>
          </button>
        </div>
      </div>
    </div>
  )
}
