import type { DashboardPayload } from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export async function getDashboard(): Promise<DashboardPayload> {
  const res = await fetch(`${API_URL}/v1/dashboard`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.message ?? `Dashboard request failed (${res.status})`)
  }
  const data = (await res.json()) as { ok: boolean; dashboard: DashboardPayload }
  return data.dashboard
}
