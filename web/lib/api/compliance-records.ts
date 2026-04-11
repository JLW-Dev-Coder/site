/**
 * Compliance Records API — wraps the TMP compliance record routes on the VLP Worker.
 *
 *   POST /v1/tmp/compliance-records                       — staff save (draft or final)
 *   GET  /v1/tmp/compliance-records/:order_id             — staff read (full canonical)
 *   GET  /v1/tmp/compliance-records/:order_id/report      — client-safe projection
 *
 * Contracts:
 *   - contracts/tmp/tmp.compliance-record.write.v1.json
 *   - contracts/tmp/tmp.compliance-record.read.v1.json
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export type ComplianceRecordStatus = 'Draft' | 'Final'

export interface ComplianceNoticePayload {
  received?: string
  date?: string
  type?: string
  cp_number?: string | null
  details?: string
}

export interface ComplianceRecordPayload {
  account_id: string
  order_id: string
  servicing_professional_id: string
  source: 'staff_compliance_records'
  compliance_record_status?: ComplianceRecordStatus
  notices?: ComplianceNoticePayload[]
  [key: string]: unknown
}

export interface SaveComplianceRecordResponse {
  ok: boolean
  status?: 'saved'
  record_status?: 'draft' | 'final'
  order_id?: string
  version?: number
  updated_at?: string
  finalized_at?: string | null
  error?: string
  message?: string
}

export interface ComplianceRecord extends ComplianceRecordPayload {
  updated_at?: string
  updated_by?: string
  created_at?: string
  finalized_at?: string | null
  finalized_by?: string
  version?: number
}

export interface GetComplianceRecordResponse {
  ok: boolean
  record?: ComplianceRecord
  error?: string
  message?: string
}

export interface ComplianceReport {
  order_id: string
  client_name?: string
  filing_status?: string
  compliance_tax_year?: number
  total_irs_balance?: string
  irs_account_status?: string
  return_processing_status?: string
  return_date_filed?: string
  return_tax_liability?: string
  notices?: ComplianceNoticePayload[]
  ia_established?: string
  ia_payment_amount?: string
  ia_payment_date?: string
  compliance_client_summary?: string
  compliance_record_status?: ComplianceRecordStatus
  compliance_prepared_date?: string
}

export interface GetComplianceReportResponse {
  ok: boolean
  report?: ComplianceReport
  error?: string
  message?: string
}

export async function saveComplianceRecord(
  payload: ComplianceRecordPayload
): Promise<SaveComplianceRecordResponse> {
  const res = await fetch(`${API_URL}/v1/tmp/compliance-records`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = (await res.json().catch(() => ({}))) as SaveComplianceRecordResponse
  return { ...data, ok: res.ok && !!data.ok }
}

export async function getComplianceRecord(
  orderId: string
): Promise<GetComplianceRecordResponse> {
  const res = await fetch(
    `${API_URL}/v1/tmp/compliance-records/${encodeURIComponent(orderId)}`,
    {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    }
  )
  if (res.status === 404) {
    return { ok: false, error: 'not_found' }
  }
  const data = (await res.json().catch(() => ({}))) as GetComplianceRecordResponse
  return { ...data, ok: res.ok && !!data.ok }
}

export async function getComplianceReport(
  orderId: string
): Promise<GetComplianceReportResponse> {
  const res = await fetch(
    `${API_URL}/v1/tmp/compliance-records/${encodeURIComponent(orderId)}/report`,
    {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    }
  )
  if (res.status === 404) {
    return { ok: false, error: 'not_found' }
  }
  const data = (await res.json().catch(() => ({}))) as GetComplianceReportResponse
  return { ...data, ok: res.ok && !!data.ok }
}
