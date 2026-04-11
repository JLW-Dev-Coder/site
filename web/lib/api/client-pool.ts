/**
 * Client Pool API — wraps GET /v1/tmp/client-pool.
 *
 * The canonical R2 record shape is not yet frozen in a contract file, so the
 * type is intentionally permissive. The page-level adapter in
 * app/(member)/client-pool/ClientPoolTable.tsx maps whatever fields are
 * present into display strings with safe fallbacks.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export type CaseStatus =
  | 'available'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'paid_out'
  | (string & {})

export interface CasePoolRecord {
  case_id: string
  status: CaseStatus
  taxpayer_name?: string
  client_name?: string
  service_plan?: string
  plan?: string
  filing_status?: string
  filing?: string
  service_fee_cents?: number
  plan_fee_cents?: number
  service_fee?: number
  platform_fee_cents?: number
  payout_cents?: number
  servicing_professional_id?: string | null
  assigned_at?: string | null
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

export interface ClientPoolResponse {
  ok: boolean
  cases: CasePoolRecord[]
  pagination: {
    page: number
    limit: number
    total: number
    total_pages: number
  }
}

export interface GetClientPoolCasesParams {
  status?: string
  professional_id?: string
  page?: number
  limit?: number
}

export async function getClientPoolCases(
  params: GetClientPoolCasesParams = {}
): Promise<ClientPoolResponse> {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.professional_id) qs.set('professional_id', params.professional_id)
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))

  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await fetch(`${API_URL}/v1/tmp/client-pool${suffix}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(body?.message ?? `Client pool request failed (${res.status})`)
  }

  const data = (await res.json()) as ClientPoolResponse
  return data
}

export interface AcceptCaseResponse {
  ok: boolean
  deduped?: boolean
  case_id?: string
  professional_id?: string
  assigned_at?: string
  status?: string
  error?: string
  message?: string
}

export async function acceptClientPoolCase(caseId: string): Promise<AcceptCaseResponse> {
  const res = await fetch(`${API_URL}/v1/tmp/client-pool/accept`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      case_id: caseId,
      professional_id: 'resolved_server_side',
    }),
  })
  const data = (await res.json().catch(() => ({}))) as AcceptCaseResponse
  return { ...data, ok: res.ok && !!data.ok }
}
