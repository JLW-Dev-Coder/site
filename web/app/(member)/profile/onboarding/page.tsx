import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Onboarding' }

export default function OnboardingPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Onboarding</h1>
      <p className="mt-1 text-sm text-white/50">
        Complete your professional profile setup.
      </p>
    </div>
  )
}
