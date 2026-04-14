/**
 * SCALE pipeline API functions — client-safe (no server-only imports).
 * Uses credentials: 'include' for session cookie auth.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export async function uploadProspectCSV(csvText: string): Promise<{
  ok: boolean
  stored?: number
  deduped?: number
  already_sent?: number
  filtered_invalid?: number
  date?: string
  error?: string
  missing?: string[]
}> {
  try {
    const res = await fetch(`${API_URL}/v1/scale/prospects/upload`, {
      method: 'PUT',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/csv' },
      body: csvText,
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data?.error ?? res.statusText, missing: data?.missing }
    return data
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export async function getScaleStatus(): Promise<{
  ok: boolean
  pending_csvs?: number
  pending_prospects?: number
  email1_queued?: number
  email1_sent_today?: number
  email1_sent_total?: number
  email2_queued?: number
  asset_pages_live?: number
  last_batch_date?: string | null
  pipeline_healthy?: boolean
}> {
  try {
    const res = await fetch(`${API_URL}/v1/scale/status`, {
      credentials: 'include',
      cache: 'no-store',
    })
    const data = await res.json()
    if (!res.ok) return { ok: false }
    return data
  } catch {
    return { ok: false }
  }
}
