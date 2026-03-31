/**
 * Client-side API utilities for affiliate functionality
 * These don't use server-side session utilities
 */

import type { AffiliateOnboardingResponse, PayoutResponse } from '@/lib/api/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export async function startAffiliateOnboarding(): Promise<AffiliateOnboardingResponse> {
  const res = await fetch(`${API_URL}/v1/affiliates/connect/onboard`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error('Failed to start onboarding')
  }

  return res.json()
}

export async function requestPayout(amount: number): Promise<PayoutResponse> {
  const res = await fetch(`${API_URL}/v1/affiliates/payout/request`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount }),
  })

  if (!res.ok) {
    throw new Error('Failed to request payout')
  }

  return res.json()
}