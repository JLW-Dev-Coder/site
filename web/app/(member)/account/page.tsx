import type { Metadata } from 'next'
import {
  Mail,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Shield,
  KeyRound,
  Smartphone,
  Monitor,
  ChevronRight,
  Crown,
  Check,
  ArrowRight,
} from 'lucide-react'
import HeroCard from '../components/HeroCard'
import StatusBadge from '../components/StatusBadge'

export const metadata: Metadata = { title: 'Account' }

/* ── placeholder data ──────────────────────────────────────────── */

const planFeatures = [
  '5 transcript tokens / month',
  '15 game tokens / month',
  'Unlimited calendar bookings',
  'Priority support',
  'Featured directory listing',
]

/* ── page ──────────────────────────────────────────────────────── */

export default function AccountPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Account</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage your account and membership.
        </p>
      </div>

      {/* Row 1: Account Details + Current Plan */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Account Details */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Account Details</h3>
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
                <CalendarDays className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Account Created</p>
                <p className="text-sm font-medium text-white">March 15, 2026</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <CheckCircle2 className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/40">Account Status</p>
                <div className="mt-0.5">
                  <StatusBadge status="active" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Current Plan */}
        <HeroCard>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-brand-orange/70">Current Plan</p>
              <p className="mt-2 text-3xl font-bold text-brand-orange">Featured</p>
              <p className="mt-1 text-sm text-white/50">$199/month</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-orange/20">
              <Crown className="h-5 w-5 text-brand-orange" />
            </div>
          </div>
          <ul className="mt-5 space-y-2.5">
            {planFeatures.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-white/70">
                <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-white/40">
            Next renewal: May 4, 2026
          </p>
        </HeroCard>
      </div>

      {/* Row 2: Payment Method + Subscription Summary */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Payment Method */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Payment Method</h3>
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <CreditCard className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Visa ending in 4242</p>
                <p className="text-xs text-white/40">Expires 12/2028</p>
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 px-4 py-2 text-sm font-medium text-brand-orange transition hover:bg-brand-orange/10">
              Update Payment Method
            </button>
            <a
              href="/account/payments"
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white/50 transition hover:text-white"
            >
              View Payment History
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>
        </div>

        {/* Subscription Summary */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Subscription Summary</h3>
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[--member-border] pb-3">
              <span className="text-sm text-white/50">Plan</span>
              <span className="text-sm font-medium text-white">Featured (VLP Scale)</span>
            </div>
            <div className="flex items-center justify-between border-b border-[--member-border] pb-3">
              <span className="text-sm text-white/50">Billing Cycle</span>
              <span className="text-sm font-medium text-white">Monthly</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Annual Cost</span>
              <span className="text-sm font-medium text-brand-orange">$2,388/year</span>
            </div>
          </div>
        </div>
      </div>

      {/* Account Security */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Account Security</h3>
        <div className="mt-5 divide-y divide-[--member-border]">
          <div className="flex items-center justify-between py-4 first:pt-0">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <KeyRound className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Change Password</p>
                <p className="text-xs text-white/40">Last changed 45 days ago</p>
              </div>
            </div>
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-[--member-border] px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/[0.04] hover:text-white">
              Update
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Smartphone className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Two-Factor Authentication</p>
                <p className="text-xs text-white/40">Not enabled</p>
              </div>
            </div>
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-brand-orange/30 px-3 py-1.5 text-xs font-medium text-brand-orange transition hover:bg-brand-orange/10">
              Enable
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="flex items-center justify-between py-4 last:pb-0">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                <Monitor className="h-4 w-4 text-brand-orange" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Active Sessions</p>
                <p className="text-xs text-white/40">2 devices</p>
              </div>
            </div>
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-[--member-border] px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/[0.04] hover:text-white">
              Manage
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
