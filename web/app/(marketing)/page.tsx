import type { Metadata } from 'next'
import HomePricingSection from '@/components/marketing/HomePricingSection'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Virtual Launch Pro — Launch Systems for Tax Professionals',
  description: 'Virtual Launch Pro gives tax professionals access to membership management, booking analytics, scheduling, directory profiles, messaging, and token-based tools at multiple plan levels.',
}

const whyItems = [
  { title: 'Membership management', body: 'Manage your account, profile, and membership settings with ease. All plans include core management features.' },
  { title: 'Transcript tools', body: 'Request and manage IRS transcripts directly through the platform. Transcript tokens are included with Starter, Scale, and Advanced plans.' },
  { title: 'Booking analytics & scheduling', body: 'Integrated scheduling and analytics help you manage appointments and track client engagement across all plans.' },
  { title: 'Directory profile & visibility', body: 'Your profile appears in the public directory. Scale and Advanced plans receive featured or top-tier placement for greater visibility.' },
  { title: 'Tax tool game tokens', body: 'Access tax resolution and planning tools with tokens. Starter, Scale, and Advanced plans include monthly token allocations.' },
  { title: 'Profile management', body: 'Build a complete professional profile with credentials, services, bio, and contact info that appears in the directory.' },
]

const offers = [
  { tier: 'STARTER', title: 'Directory access & token tools', featured: false, body: 'For solo tax professionals who want a directory profile, basic messaging, and monthly token allocations.', items: ['Directory profile listing.', 'Messaging (Pro ↔ Taxpayer).', '30 Tax Tool Game Tokens & 30 Transcript Tokens per month.'] },
  { tier: 'SCALE', title: 'Featured directory & more tokens', featured: true, body: 'For growing practices that want featured directory placement and higher monthly token limits.', items: ['Featured directory profile.', 'Messaging (Pro ↔ Taxpayer).', '120 Tax Tool Game Tokens & 100 Transcript Tokens per month.'] },
  { tier: 'ADVANCED', title: 'Top-tier visibility & max tokens', featured: false, body: 'For high-volume practices needing top-tier directory placement and the highest monthly token limits.', items: ['Top-tier directory profile.', 'Messaging (Pro ↔ Taxpayer).', '300 Tax Tool Game Tokens & 250 Transcript Tokens per month.'] },
]

const audiences = [
  { title: 'Solo tax professionals', body: 'Get a directory profile, manage your practice, and access essential tools without building your own tech stack.' },
  { title: 'Small tax firms', body: 'Equip your team with transcript tools, booking analytics, and a professional directory presence that scales with client volume.' },
  { title: 'High-volume tax practices', body: 'Unlock top-tier directory placement and maximum token capacity to support a full caseload.' },
]

const faqs = [
  { q: 'Is it hard to set up?', a: 'No. Each install is scoped and configured cleanly. You get a structured handoff so you can operate immediately.' },
  { q: 'Do clients need to log in?', a: 'No. Clients use simple links for intake, payment, uploads, and status. Your delivery system stays internal and stable.' },
  { q: 'What makes Virtual Launch Pro different?', a: 'It is built around deliverables, workflow visibility, and scope protection instead of making you collect more disconnected tools.' },
]

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <section className="mx-auto max-w-[77.5rem] px-4 pb-10 pt-16 md:pb-14 md:pt-24">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/50 px-4 py-2">
            <svg className="h-4 w-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
            <span className="text-sm text-slate-300">Choose your plan level. Upgrade anytime.</span>
          </div>
          <h1 className="mb-6 text-4xl font-bold tracking-tight md:text-6xl lg:text-7xl">
            Launch systems for{' '}
            <span className="bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent">tax professionals.</span>
          </h1>
          <p className="mx-auto mb-12 max-w-3xl text-xl leading-relaxed text-slate-400 md:text-2xl">
            Join Virtual Launch Pro to access membership management, booking analytics, scheduling, directory profiles, messaging, and token-based tools. Pick the membership that fits your practice.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a href="#pricing" className="inline-block rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-8 py-4 text-lg font-semibold text-slate-950 shadow-lg shadow-amber-500/25 transition-all duration-200 hover:scale-105 hover:from-amber-400 hover:to-amber-500">View packages →</a>
            <a href="#offers" className="inline-block rounded-lg border border-slate-700 bg-slate-900/60 px-8 py-4 text-lg font-semibold text-slate-100 transition-all duration-200 hover:bg-slate-800/80">Explore offers</a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[77.5rem] px-4 pb-14 md:pb-20">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.12)] md:p-8">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { tier: 'FREE', title: 'Get started', body: 'Build your profile and access core platform features. Upgrade anytime for more tools.' },
              { tier: 'STARTER', title: 'Directory & tokens', body: 'Get a directory profile, messaging, and monthly token allocations for tax tools and transcripts.' },
              { tier: 'SCALE', title: 'Featured & more tokens', body: 'Get featured directory placement and higher monthly token limits for growing practices.', highlight: true },
              { tier: 'ADVANCED', title: 'Top-tier & max tokens', body: 'Get top-tier directory placement and the highest monthly token limits for high-volume practices.' },
            ].map((p) => (
              <div key={p.tier} className={`rounded-2xl p-6 ${'highlight' in p && p.highlight ? 'border border-orange-500/40 bg-orange-500/10' : 'border border-white/10 bg-[#070a10]/60'}`}>
                <div className="text-xs font-semibold tracking-widest text-orange-400">{p.tier}</div>
                <div className="mt-3 text-xl font-extrabold">{p.title}</div>
                <p className="mt-3 text-sm text-white/70">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-[77.5rem] px-4 py-16 md:py-20">
          <div className="mx-auto max-w-4xl text-center mb-12">
            <p className="text-xs font-semibold tracking-widest text-orange-400">WHY VIRTUAL LAUNCH PRO WORKS</p>
            <h2 className="mt-3 text-4xl font-extrabold md:text-5xl">Built for tax professionals, not generic service firms</h2>
            <p className="mx-auto mt-6 max-w-3xl text-base text-white/70 md:text-lg">Virtual Launch Pro is built around the tools tax professionals actually use — membership management, transcript requests, booking analytics, and a professional directory listing that drives inbound cases.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {whyItems.map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
                <h3 className="text-lg font-extrabold mb-3">{item.title}</h3>
                <p className="text-sm text-white/70">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 flex justify-center">
            <Link href="/features" className="rounded-xl bg-orange-500 px-8 py-4 text-sm font-extrabold text-[#070a10] hover:bg-orange-400 transition-colors">See all features</Link>
          </div>
        </div>
      </section>

      <section id="offers" className="border-t border-white/10">
        <div className="mx-auto max-w-[77.5rem] px-4 py-16 md:py-20">
          <div className="mx-auto max-w-3xl text-center mb-12">
            <p className="text-xs font-semibold tracking-widest text-orange-400">OFFERS</p>
            <h2 className="mt-4 text-4xl font-extrabold md:text-5xl">Three tiers built for different practice sizes</h2>
            <p className="mx-auto mt-5 max-w-2xl text-base text-white/70">Start with the membership that matches your volume, then upgrade when your caseload justifies it.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {offers.map((o) => (
              <article key={o.tier} className={`rounded-2xl p-8 shadow-[0_10px_30px_rgba(0,0,0,0.12)] ${o.featured ? 'border-2 border-orange-500/70 bg-gradient-to-b from-white/8 to-white/5' : 'border border-white/10 bg-white/5'}`}>
                <div className="text-sm font-semibold tracking-widest text-orange-400">{o.tier}</div>
                <h3 className="mt-3 text-2xl font-extrabold">{o.title}</h3>
                <p className="mt-4 text-sm text-white/70">{o.body}</p>
                <ul className="mt-6 space-y-3 text-sm text-white/75">
                  {o.items.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="border-t border-white/10">
        <HomePricingSection />
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-[77.5rem] px-4 py-14 md:py-16">
          <div className="rounded-2xl bg-orange-500 px-6 py-10 shadow-[0_10px_30px_rgba(0,0,0,0.12)] md:px-10 md:py-14">
            <div className="grid gap-10 text-center md:grid-cols-4 md:gap-8">
              {[
                { label: 'Save Time', body: 'Spend less time answering status questions and more time delivering real work.' },
                { label: 'Increase Revenue', body: 'Defined deliverables and follow-ups help convert more clients with less friction.' },
                { label: 'Stay Organized', body: 'Keep intake, files, messages, and payments in one calm, structured system.' },
                { label: 'Grow Affordably', body: 'Install once, then add modules only when your business is ready to expand.' },
              ].map((b) => (
                <div key={b.label}>
                  <div className="text-lg font-extrabold text-white">{b.label}</div>
                  <p className="mx-auto mt-3 max-w-xs text-sm text-white/90">{b.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#070a10]">
        <div className="mx-auto max-w-[77.5rem] px-4 py-16 md:py-20">
          <div className="mx-auto max-w-3xl text-center mb-14">
            <p className="text-xs font-semibold tracking-widest text-orange-400">WHO VIRTUAL LAUNCH PRO IS FOR</p>
            <h2 className="mt-4 text-4xl font-extrabold text-white md:text-5xl">Built for tax professionals at every scale</h2>
            <p className="mx-auto mt-5 max-w-2xl text-base text-white/70">Virtual Launch Pro supports tax professionals at every stage — solo practitioners, small firms, and high-volume practices that need real infrastructure to grow.</p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {audiences.map((a) => (
              <div key={a.title} className="rounded-2xl border-2 border-amber-500 bg-amber-500/10 p-8 backdrop-blur-sm">
                <h3 className="text-lg font-extrabold text-white mb-3">{a.title}</h3>
                <p className="text-sm text-white/70">{a.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-14 flex justify-center">
            <a href="#pricing" className="rounded-xl bg-orange-500 px-8 py-4 text-sm font-extrabold text-[#070a10] hover:bg-orange-400 transition-colors">Choose a package</a>
          </div>
        </div>
      </section>

      <section id="faq" className="border-t border-white/10">
        <div className="mx-auto max-w-[77.5rem] px-4 py-14 md:py-16">
          <div className="mx-auto max-w-3xl text-center mb-10">
            <h2 className="text-3xl font-extrabold md:text-4xl">Frequently asked questions</h2>
          </div>
          <div className="mx-auto max-w-3xl space-y-4">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-2xl border border-white/10 bg-white/5 p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between text-left font-semibold">
                  {f.q}<span className="ml-4 text-white/60 transition-transform group-open:rotate-180">▾</span>
                </summary>
                <p className="mt-3 text-sm text-white/70">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-gradient-to-br from-[#0f172a] via-[#1c1917] to-[#7c2d12] text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">Ready to launch calmly?</h2>
          <p className="text-lg md:text-xl text-white/80 mb-8 max-w-2xl mx-auto">Pick the membership that fits your practice and start building a cleaner client journey today.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="#pricing" className="bg-orange-500 hover:bg-orange-400 text-white font-bold px-10 py-4 rounded-xl text-lg transition-all shadow-lg hover:shadow-xl">Become a member</a>
            <Link href="/contact" className="bg-white/10 hover:bg-white/15 text-white font-semibold px-10 py-4 rounded-xl text-lg border border-orange-400/20 transition-all">Contact Us</Link>
          </div>
          <p className="text-white/60 text-sm mt-8">Become a member • Deliver calmly • Repeat</p>
        </div>
      </section>
    </div>
  )
}