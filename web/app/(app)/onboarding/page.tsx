'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalConnectionCard } from '@/components/cal/CalConnectionCard'

const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware',
  'Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky',
  'Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi',
  'Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico',
  'New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania',
  'Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
  'Virginia','Washington','West Virginia','Wisconsin','Wyoming',
]

const PROFESSIONS = [
  'CPA (Certified Public Accountant)',
  'EA (Enrolled Agent)',
  'Tax Attorney / JD',
  'AFSP (Annual Filing Season Program)',
  'RTRP (Registered Tax Return Preparer)',
  'Tax Preparer (unlicensed)',
  'Bookkeeper',
  'Financial Advisor / Planner',
  'Other',
]

const SERVICES = [
  'Tax Litigation','Audit Defense','Tax Planning','Appeals','Compliance','Consulting',
  'Tax Preparation','Tax Resolution','Tax Monitoring','IRS Collections Defense',
  'Offer in Compromise','Penalty Abatement','Payroll Tax Defense',
  'Trust Fund Recovery Defense','Expert Witness','Foreign Reporting',
  'Business Tax Advisory','Estate & Trust Tax',
]

const LANGUAGES = [
  'English','Spanish','Chinese','Arabic','French','German','Hindi',
  'Japanese','Korean','Portuguese','Russian','Tagalog','Vietnamese',
]

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

interface FormData {
  // Step 1
  fullName: string
  initials: string
  bioShort: string
  // Step 2
  yearsExperience: string
  state: string
  city: string
  firmName: string
  professions: string[]
  // Step 3
  aboutHeading: string
  bio1: string
  bio2: string
  bio3: string
  // Step 4
  servicesHeading: string
  primaryService: string
  additionalServices: string[]
  credentialsHeading: string
  primaryCredential: string
  additionalCredentials: string
  // Step 5
  email: string
  phone: string
  languages: string[]
  availabilityText: string
  weeklyAvailability: Record<string, { enabled: boolean; start: string; end: string }>
  calBookingUrl: string
  otherProfession: string
}

const defaultAvailability = Object.fromEntries(
  DAYS.map((d) => [d, { enabled: false, start: '09:00', end: '17:00' }])
)

const INITIAL: FormData = {
  fullName: '', initials: '', bioShort: '',
  yearsExperience: '', state: '', city: '', firmName: '', professions: [],
  aboutHeading: 'About Me', bio1: '', bio2: '', bio3: '',
  servicesHeading: 'Services', primaryService: '', additionalServices: [],
  credentialsHeading: 'Credentials', primaryCredential: '', additionalCredentials: '',
  email: '', phone: '', languages: [], availabilityText: '',
  weeklyAvailability: defaultAvailability,
  calBookingUrl: '',
  otherProfession: '',
}

const STEP_LABELS = [
  'Personal Info',
  'Professional Details',
  'About & Bio',
  'Services & Credentials',
  'Contact & Review',
  'Preview & Save',
]

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                done
                  ? 'bg-emerald-500 text-white'
                  : active
                  ? 'bg-gradient-to-br from-orange-500 to-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              {done ? '✓' : i + 1}
            </div>
            {i < total - 1 && (
              <div className={`h-0.5 w-6 rounded ${done ? 'bg-emerald-500' : 'bg-slate-800'}`} />
            )}
          </div>
        )
      })}
      <span className="ml-2 text-xs text-slate-400">{STEP_LABELS[current]}</span>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wide">{children}</label>
}

function Input({ value, onChange, placeholder, maxLength }: {
  value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number
}) {
  return (
    <input
      className="w-full rounded-xl border border-slate-800/60 bg-slate-900/60 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
    />
  )
}

function Textarea({ value, onChange, placeholder, maxLength, rows = 4 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; rows?: number
}) {
  return (
    <textarea
      className="w-full rounded-xl border border-slate-800/60 bg-slate-900/60 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none resize-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={rows}
    />
  )
}

function MultiSelect({ options, selected, onChange }: {
  options: string[]; selected: string[]; onChange: (v: string[]) => void
}) {
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt])
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
            selected.includes(opt)
              ? 'bg-orange-500 text-slate-950'
              : 'border border-slate-700 bg-slate-800/60 text-slate-300 hover:border-orange-500/40'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6">
      {children}
    </div>
  )
}

// ── Step components ──────────────────────────────────────────────────────────

function Step1({ form, set }: { form: FormData; set: (k: keyof FormData, v: unknown) => void }) {
  return (
    <FormCard>
      <h2 className="mb-6 text-lg font-bold text-white">Personal Info</h2>
      <div className="space-y-4">
        <div>
          <Label>Full Name</Label>
          <Input value={form.fullName} onChange={(v) => set('fullName', v)} placeholder="Jane Smith" />
        </div>
        <div>
          <Label>Initials (2–4 characters, used in avatar)</Label>
          <Input value={form.initials} onChange={(v) => set('initials', v.slice(0, 4).toUpperCase())} placeholder="JS" maxLength={4} />
          <p className="mt-1 text-xs text-slate-500">{form.initials.length}/4 characters</p>
        </div>
        <div>
          <Label>Short Bio (max 220 characters)</Label>
          <Textarea value={form.bioShort} onChange={(v) => set('bioShort', v)} placeholder="One-line headline that appears under your name." maxLength={220} rows={3} />
          <p className="mt-1 text-xs text-slate-500">{form.bioShort.length}/220 characters</p>
        </div>
      </div>
    </FormCard>
  )
}

function Step2({ form, set }: { form: FormData; set: (k: keyof FormData, v: unknown) => void }) {
  return (
    <FormCard>
      <h2 className="mb-6 text-lg font-bold text-white">Professional Details</h2>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Years of Experience</Label>
            <Input value={form.yearsExperience} onChange={(v) => set('yearsExperience', v)} placeholder="12" />
          </div>
          <div>
            <Label>State</Label>
            <div className="relative">
              <select
                className="w-full appearance-none rounded-[0.625rem] border border-white/15 bg-white/[0.08] px-4 py-3 text-sm text-white focus:border-orange-500 focus:outline-none"
                style={{ backgroundImage: 'none' }}
                value={form.state}
                onChange={(e) => set('state', e.target.value)}
              >
                <option value="" className="bg-[#0f1420] text-white">Select state...</option>
                {US_STATES.map((s) => <option key={s} value={s} className="bg-[#0f1420] text-white">{s}</option>)}
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>City</Label>
            <Input value={form.city} onChange={(v) => set('city', v)} placeholder="Dallas" />
          </div>
          <div>
            <Label>Firm Name (optional)</Label>
            <Input value={form.firmName} onChange={(v) => set('firmName', v)} placeholder="Smith Tax Group" />
          </div>
        </div>
        <div>
          <Label>Profession (select all that apply)</Label>
          <MultiSelect options={PROFESSIONS} selected={form.professions} onChange={(v) => set('professions', v)} />
          {form.professions.includes('Other') && (
            <div className="mt-2">
              <Input value={form.otherProfession} onChange={(v) => set('otherProfession', v)} placeholder="Please specify your profession" />
            </div>
          )}
        </div>
      </div>
    </FormCard>
  )
}

function Step3({ form, set }: { form: FormData; set: (k: keyof FormData, v: unknown) => void }) {
  return (
    <FormCard>
      <h2 className="mb-6 text-lg font-bold text-white">About & Bio</h2>
      <div className="space-y-4">
        <div>
          <Label>About Section Heading</Label>
          <Input value={form.aboutHeading} onChange={(v) => set('aboutHeading', v)} placeholder="About Me" />
        </div>
        <div>
          <Label>Bio Paragraph 1 (required, max 1200 characters)</Label>
          <Textarea value={form.bio1} onChange={(v) => set('bio1', v)} placeholder="Tell clients about your background and what you specialize in…" maxLength={1200} rows={5} />
          <p className="mt-1 text-xs text-slate-500">{form.bio1.length}/1200 characters</p>
        </div>
        <div>
          <Label>Bio Paragraph 2 (optional)</Label>
          <Textarea value={form.bio2} onChange={(v) => set('bio2', v)} placeholder="Additional context about your approach or experience…" rows={4} />
        </div>
        <div>
          <Label>Bio Paragraph 3 (optional)</Label>
          <Textarea value={form.bio3} onChange={(v) => set('bio3', v)} placeholder="Anything else you'd like clients to know…" rows={4} />
        </div>
      </div>
    </FormCard>
  )
}

function Step4({ form, set }: { form: FormData; set: (k: keyof FormData, v: unknown) => void }) {
  return (
    <FormCard>
      <h2 className="mb-6 text-lg font-bold text-white">Services & Credentials</h2>
      <div className="space-y-4">
        <div>
          <Label>Services Section Heading</Label>
          <Input value={form.servicesHeading} onChange={(v) => set('servicesHeading', v)} placeholder="Services" />
        </div>
        <div>
          <Label>Primary Service</Label>
          <div className="relative">
            <select
              className="w-full appearance-none rounded-[0.625rem] border border-white/15 bg-white/[0.08] px-4 py-3 text-sm text-white focus:border-orange-500 focus:outline-none"
              style={{ backgroundImage: 'none' }}
              value={form.primaryService}
              onChange={(e) => set('primaryService', e.target.value)}
            >
              <option value="" className="bg-[#0f1420] text-white">Select primary service...</option>
              {SERVICES.map((s) => <option key={s} value={s} className="bg-[#0f1420] text-white">{s}</option>)}
            </select>
            <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </div>
        </div>
        <div>
          <Label>Additional Services</Label>
          <MultiSelect
            options={SERVICES.filter((s) => s !== form.primaryService)}
            selected={form.additionalServices}
            onChange={(v) => set('additionalServices', v)}
          />
        </div>
        <div>
          <Label>Credentials Section Heading</Label>
          <Input value={form.credentialsHeading} onChange={(v) => set('credentialsHeading', v)} placeholder="Credentials" />
        </div>
        <div>
          <Label>Primary Credential</Label>
          <Input value={form.primaryCredential} onChange={(v) => set('primaryCredential', v)} placeholder="e.g. EA, CPA, JD" />
        </div>
        <div>
          <Label>Additional Credentials (comma-separated)</Label>
          <Input value={form.additionalCredentials} onChange={(v) => set('additionalCredentials', v)} placeholder="e.g. MBA, LLM, CFP" />
        </div>
      </div>
    </FormCard>
  )
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length <= 3) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function Step5({ form, set, calProConnected, calConnecting, onCalConnect }: {
  form: FormData
  set: (k: keyof FormData, v: unknown) => void
  calProConnected: boolean
  calConnecting: boolean
  onCalConnect: () => void
}) {
  const toggleDay = (day: string) => {
    const current = form.weeklyAvailability[day]
    set('weeklyAvailability', { ...form.weeklyAvailability, [day]: { ...current, enabled: !current.enabled } })
  }
  const setTime = (day: string, field: 'start' | 'end', value: string) => {
    const current = form.weeklyAvailability[day]
    set('weeklyAvailability', { ...form.weeklyAvailability, [day]: { ...current, [field]: value } })
  }

  return (
    <FormCard>
      <h2 className="mb-6 text-lg font-bold text-white">Contact & Availability</h2>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Email</Label>
            <Input value={form.email} onChange={(v) => set('email', v)} placeholder="jane@smithtax.com" />
          </div>
          <div>
            <Label>Phone</Label>
            <input
              className="w-full rounded-xl border border-slate-800/60 bg-slate-900/60 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              onBlur={(e) => set('phone', normalizePhone(e.target.value))}
              placeholder="(555) 000-0000"
            />
          </div>
        </div>
        <div>
          <Label>Languages</Label>
          <MultiSelect options={LANGUAGES} selected={form.languages} onChange={(v) => set('languages', v)} />
        </div>
        <div>
          <Label>Availability Display Text</Label>
          <Input value={form.availabilityText} onChange={(v) => set('availabilityText', v)} placeholder="Mon–Fri, 9am–5pm CST" />
        </div>
        <div>
          <Label>Weekly Availability</Label>
          <div className="space-y-2 mt-2">
            {DAYS.map((day) => {
              const avail = form.weeklyAvailability[day]
              return (
                <div key={day} className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`w-12 rounded-full px-2 py-1 text-xs font-bold transition ${avail.enabled ? 'bg-orange-500 text-slate-950' : 'border border-slate-700 text-slate-500'}`}
                  >
                    {day}
                  </button>
                  {avail.enabled && (
                    <>
                      <input
                        type="time"
                        value={avail.start}
                        onChange={(e) => setTime(day, 'start', e.target.value)}
                        className="rounded-lg border border-slate-800/60 bg-slate-900/60 px-2 py-1 text-xs text-white focus:outline-none"
                      />
                      <span className="text-xs text-slate-500">to</span>
                      <input
                        type="time"
                        value={avail.end}
                        onChange={(e) => setTime(day, 'end', e.target.value)}
                        className="rounded-lg border border-slate-800/60 bg-slate-900/60 px-2 py-1 text-xs text-white focus:outline-none"
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div>
          <Label>Cal.com Account</Label>
          <CalConnectionCard
            variant="profile"
            vlpConnected={false}
            proConnected={calProConnected}
            onConnectVlp={() => {}}
            onConnectPro={onCalConnect}
            connecting={calConnecting}
            error={null}
          />
        </div>
        <div>
          <Label>Your Cal.com Booking Link (optional)</Label>
          <input
            type="url"
            value={form.calBookingUrl}
            onChange={(e) => {
              set('calBookingUrl', e.target.value)
              localStorage.setItem('vlp_cal_booking_url', e.target.value)
            }}
            placeholder="https://cal.com/your-username/event-type"
            className="w-full rounded-xl border border-slate-800/60 bg-slate-900/60 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-500">This URL appears as the Schedule button on your public profile.</p>
        </div>
      </div>
    </FormCard>
  )
}

// ── Live profile preview ──────────────────────────────────────────────────────

function LivePreview({ form }: { form: FormData }) {
  const additionalCreds = form.additionalCredentials
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const ph = 'text-slate-600 italic'

  return (
    <div className="space-y-3 text-sm">
      {/* Hero */}
      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-sm font-bold text-slate-950">
            {form.initials || <span className={ph}>??</span>}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-white">{form.fullName || <span className={ph}>Your Name</span>}</div>
            <div className="mt-0.5 text-xs text-slate-400 line-clamp-2">{form.bioShort || <span className={ph}>Short bio…</span>}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(form.city || form.state) ? (
                <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300">
                  {[form.city, form.state].filter(Boolean).join(', ')}
                </span>
              ) : (
                <span className={`rounded-full border border-slate-800 px-2 py-0.5 text-xs ${ph}`}>City, State</span>
              )}
              {form.yearsExperience ? (
                <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300">{form.yearsExperience} yrs</span>
              ) : (
                <span className={`rounded-full border border-slate-800 px-2 py-0.5 text-xs ${ph}`}>X yrs exp</span>
              )}
              {form.professions.map((p) => (
                <span key={p} className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-xs text-orange-300">{p}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4" style={{ borderLeft: '3px solid rgb(249,115,22)' }}>
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-orange-400">{form.aboutHeading || 'About Me'}</div>
        <p className="text-xs leading-relaxed text-slate-300 line-clamp-4">
          {form.bio1 || <span className={ph}>Your bio will appear here…</span>}
        </p>
      </div>

      {/* Services */}
      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-orange-400">{form.servicesHeading || 'Services'}</div>
        {form.primaryService ? (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-white">{form.primaryService}</div>
            {form.additionalServices.slice(0, 3).map((s) => (
              <div key={s} className="text-xs text-slate-400">{s}</div>
            ))}
          </div>
        ) : (
          <p className={`text-xs ${ph}`}>Services will appear here…</p>
        )}
      </div>

      {/* Credentials */}
      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-orange-400">{form.credentialsHeading || 'Credentials'}</div>
        {form.primaryCredential ? (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-white">{form.primaryCredential}</div>
            {additionalCreds.map((c) => (
              <div key={c} className="text-xs text-slate-400">{c}</div>
            ))}
          </div>
        ) : (
          <p className={`text-xs ${ph}`}>Credentials will appear here…</p>
        )}
      </div>

      {/* Contact */}
      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-orange-400">Contact</div>
        <dl className="space-y-1 text-xs">
          <div><dt className="text-slate-500">Email</dt><dd className="text-slate-300">{form.email || <span className={ph}>email@example.com</span>}</dd></div>
          <div><dt className="text-slate-500">Phone</dt><dd className="text-slate-300">{form.phone || <span className={ph}>+1 (555) 000-0000</span>}</dd></div>
        </dl>
      </div>
    </div>
  )
}

// ── Full profile preview (step 6) ─────────────────────────────────────────────

function ProfilePreview({ form }: { form: FormData }) {
  const additionalCreds = form.additionalCredentials
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return (
    <div className="space-y-4">
      {/* Hero card */}
      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6">
        <div className="flex items-start gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-xl font-bold text-slate-950">
            {form.initials || '?'}
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold text-white">{form.fullName || 'Your Name'}</div>
            <div className="mt-1 text-sm text-slate-400">{form.bioShort || 'Your short bio will appear here.'}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {form.city && form.state && (
                <span className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300">
                  {form.city}, {form.state}
                </span>
              )}
              {form.yearsExperience && (
                <span className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300">
                  {form.yearsExperience} yrs experience
                </span>
              )}
              {form.professions.map((p) => (
                <span key={p} className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs text-orange-300">{p}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {form.bio1 && (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6" style={{ borderLeft: '4px solid rgb(249,115,22)' }}>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-orange-400">{form.aboutHeading || 'About Me'}</h3>
          <p className="text-sm text-slate-300 leading-relaxed">{form.bio1}</p>
          {form.bio2 && <p className="mt-3 text-sm text-slate-300 leading-relaxed">{form.bio2}</p>}
          {form.bio3 && <p className="mt-3 text-sm text-slate-300 leading-relaxed">{form.bio3}</p>}
        </div>
      )}

      {form.primaryService && (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-orange-400">{form.servicesHeading || 'Services'}</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-orange-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              <span className="text-sm font-semibold text-white">{form.primaryService}</span>
            </div>
            {form.additionalServices.map((svc) => (
              <div key={svc} className="flex items-center gap-2 pl-1">
                <svg className="h-4 w-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-sm text-slate-300">{svc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {form.primaryCredential && (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-orange-400">{form.credentialsHeading || 'Credentials'}</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="text-sm font-semibold text-white">{form.primaryCredential}</span>
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

      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-orange-400">Contact</h3>
        <dl className="space-y-2 text-sm">
          {form.email && <div><dt className="text-xs text-slate-500">Email</dt><dd className="text-slate-300">{form.email}</dd></div>}
          {form.phone && <div><dt className="text-xs text-slate-500">Phone</dt><dd className="text-slate-300">{form.phone}</dd></div>}
          {form.firmName && <div><dt className="text-xs text-slate-500">Firm</dt><dd className="text-slate-300">{form.firmName}</dd></div>}
          {form.languages.length > 0 && <div><dt className="text-xs text-slate-500">Languages</dt><dd className="text-slate-300">{form.languages.join(', ')}</dd></div>}
          {form.availabilityText && <div><dt className="text-xs text-slate-500">Availability</dt><dd className="text-slate-300">{form.availabilityText}</dd></div>}
        </dl>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const PROFILE_COMPLETED_KEY = 'vlp_profile_completed'
const DRAFT_KEY = 'vlp_onboarding_draft'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormData>(INITIAL)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calProConnected, setCalProConnected] = useState(false)
  const [calConnecting, setCalConnecting] = useState(false)
  const [isFirstSignin, setIsFirstSignin] = useState(false)
  const [savedProfileId, setSavedProfileId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Load saved draft on mount
  useEffect(() => {
    const draft = localStorage.getItem(DRAFT_KEY)
    if (draft) {
      try {
        const parsed = JSON.parse(draft)
        setForm((prev) => ({ ...prev, ...parsed }))
      } catch { /* ignore corrupt draft */ }
    }
  }, [])

  // Auto-save form to localStorage (debounced 300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
    }, 300)
    return () => clearTimeout(timer)
  }, [form])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('cal') === 'connected') {
      setCalProConnected(true)
      window.history.replaceState({}, '', '/onboarding')
    }
    const stepParam = parseInt(params.get('step') || '', 10)
    if (!Number.isNaN(stepParam) && stepParam >= 0 && stepParam <= 5) {
      setStep(stepParam)
    }
    // First signin = no profile-completed flag in localStorage
    setIsFirstSignin(!localStorage.getItem(PROFILE_COMPLETED_KEY))
  }, [])

  const set = (key: keyof FormData, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleCalProConnect() {
    setCalConnecting(true)
    try {
      const res = await fetch('https://api.virtuallaunch.pro/v1/cal/pro/oauth/start', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      if (data.authorizationUrl) window.location.href = data.authorizationUrl
    } catch {
      // ignore — user can retry
    } finally {
      setCalConnecting(false)
    }
  }

  const next = () => setStep((s) => Math.min(s + 1, 5))
  const back = () => setStep((s) => Math.max(s - 1, 0))
  const skip = () => {
    localStorage.setItem(PROFILE_COMPLETED_KEY, '1')
    router.push('/dashboard')
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      // Required fields gate — must match backend POST /v1/profiles
      const displayName = form.fullName.trim()
      if (!displayName) {
        setError('Full name is required.')
        setStep(0)
        setSaving(false)
        return
      }
      // Derive a deterministic professionalId from the display name
      const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const professionalId = `pro-${slug}-${Math.random().toString(36).slice(2, 8)}`

      const res = await fetch('https://api.virtuallaunch.pro/v1/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...form, professionalId, displayName }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { message?: string }).message || 'Save failed. Please try again.')
        return
      }
      const data = await res.json().catch(() => ({})) as { profile?: { professionalId?: string } }
      const savedId = data.profile?.professionalId || professionalId
      localStorage.setItem(PROFILE_COMPLETED_KEY, '1')
      localStorage.setItem('vlp_professional_id', savedId)
      localStorage.removeItem(DRAFT_KEY)
      setSavedProfileId(savedId)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const profileUrl = savedProfileId ? `https://virtuallaunch.pro/profile/${savedProfileId}` : ''

  const handleCopy = () => {
    navigator.clipboard.writeText(profileUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Show success screen after save
  if (savedProfileId) {
    return (
      <div className="mx-auto max-w-2xl py-16 px-6 text-center">
        <div className="flex items-center justify-center mb-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-500 text-2xl font-bold text-white">
            &#10003;
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white">Profile Saved!</h1>
        <p className="mt-2 text-sm text-slate-400">Your directory profile is now live.</p>

        <div className="mt-8 rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6 text-left">
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
              href={`mailto:?subject=${encodeURIComponent('Check out my profile on Virtual Launch Pro')}&body=${encodeURIComponent(`View my professional profile: ${profileUrl}`)}`}
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition"
            >
              Email
            </a>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={() => router.push(`/profile/${savedProfileId}`)}
            className="rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
          >
            View My Profile in Directory
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded-xl border border-slate-700 bg-slate-900/60 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:text-white transition"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  const wrapperClass = isFirstSignin
    ? 'fixed inset-0 z-50 overflow-y-auto bg-slate-950 px-6 py-8'
    : ''
  const innerClass = isFirstSignin ? 'mx-auto max-w-6xl' : 'mx-auto max-w-6xl py-8'

  return (
    <div className={wrapperClass}>
    <div className={innerClass}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Directory Profile</h1>
          <p className="mt-1 text-sm text-slate-400">Build your public Tax Monitor network profile.</p>
        </div>
        {isFirstSignin && (
          <button
            type="button"
            onClick={skip}
            className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm text-slate-400 hover:text-white transition"
          >
            Skip
          </button>
        )}
      </div>

      <StepIndicator current={step} total={6} />

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        {/* Left — form */}
        <div className="space-y-6 min-w-0">
          {step === 0 && <Step1 form={form} set={set} />}
          {step === 1 && <Step2 form={form} set={set} />}
          {step === 2 && <Step3 form={form} set={set} />}
          {step === 3 && <Step4 form={form} set={set} />}
          {step === 4 && <Step5 form={form} set={set} calProConnected={calProConnected} calConnecting={calConnecting} onCalConnect={handleCalProConnect} />}
          {step === 5 && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4">
                <p className="text-sm font-semibold text-slate-300">Profile Preview</p>
                <p className="mt-0.5 text-xs text-slate-500">This is how your profile will appear in the Tax Monitor directory.</p>
              </div>
              {/* Full preview on mobile (step 6 only) */}
              <div className="lg:hidden">
                <ProfilePreview form={form} />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
          )}

          {step < 5 && error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={back}
              disabled={step === 0}
              className="rounded-xl border border-slate-700 bg-slate-900/60 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:text-white transition disabled:opacity-40"
            >
              Back
            </button>
            {step < 5 ? (
              <button
                type="button"
                onClick={next}
                className="rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
              >
                Continue →
              </button>
            ) : (
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
            )}
          </div>
        </div>

        {/* Right — live preview (always visible on lg) */}
        <div className={`hidden lg:block`}>
          <div className="sticky top-8">
            <div className="mb-3 rounded-xl border border-slate-800/60 bg-slate-900/40 px-4 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Live Preview</p>
            </div>
            {step < 5 ? (
              <LivePreview form={form} />
            ) : (
              <ProfilePreview form={form} />
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}
