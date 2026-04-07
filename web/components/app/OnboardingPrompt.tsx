'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const STORAGE_KEY = 'vlp_onboarding_prompt_dismissed'
const PROFILE_COMPLETED_KEY = 'vlp_profile_completed'

export default function OnboardingPrompt() {
  const router = useRouter()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // If required profile fields (professionalId, displayName) are missing,
    // redirect back to the onboarding step that collects them (step 0).
    if (!localStorage.getItem(PROFILE_COMPLETED_KEY)) {
      router.replace('/onboarding?step=0')
      return
    }
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
  }, [router])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-orange-300">Complete your profile</div>
          <p className="mt-1 text-sm text-slate-300">
            Complete your profile to appear in the Tax Monitor network directory.
          </p>
          <Link
            href="/onboarding"
            className="mt-3 inline-block rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
          >
            Set up profile →
          </Link>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-slate-500 hover:text-slate-300 transition"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
