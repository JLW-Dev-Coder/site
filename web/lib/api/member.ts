/**
 * Member app API helpers — cookie-based, wraps the VLP Worker endpoints
 * used across the authenticated member dashboard pages.
 *
 * All functions use the `vlp_session` HttpOnly cookie for auth. They return
 * parsed JSON bodies and throw on non-2xx so callers can render fallbacks.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(body?.message ?? `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(json?.message ?? `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Bookings — GET /v1/bookings/by-account/:account_id
// ---------------------------------------------------------------------------

export interface BookingRow {
  booking_id: string
  account_id: string
  professional_id?: string | null
  booking_type?: string | null
  scheduled_at: string
  timezone?: string | null
  status?: string | null
  client_name?: string | null
  client_email?: string | null
  service?: string | null
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

export async function getBookingsByAccount(accountId: string): Promise<BookingRow[]> {
  const data = await apiGet<{ ok: boolean; bookings: BookingRow[] }>(
    `/v1/bookings/by-account/${accountId}`
  )
  return data.bookings ?? []
}

// ---------------------------------------------------------------------------
// Tokens — GET /v1/tokens/balance/:account_id
//          GET /v1/tokens/usage/:account_id
// ---------------------------------------------------------------------------

export interface TokenBalanceRow {
  accountId: string
  taxGameTokens: number
  transcriptTokens: number
  tax_game_tokens?: number
  transcript_tokens?: number
  updatedAt: string | null
}

export async function getTokenBalance(accountId: string): Promise<TokenBalanceRow> {
  const data = await apiGet<{ ok: boolean; balance: TokenBalanceRow }>(
    `/v1/tokens/balance/${accountId}`
  )
  return data.balance
}

export interface TokenUsageRow {
  eventId: string
  accountId: string
  tokenType: 'transcript' | 'tax_game' | string
  amount: number
  action: string
  createdAt: string
}

export async function getTokenUsage(
  accountId: string,
  limit = 50
): Promise<TokenUsageRow[]> {
  const data = await apiGet<{ ok: boolean; usage: TokenUsageRow[] }>(
    `/v1/tokens/usage/${accountId}?limit=${limit}`
  )
  return data.usage ?? []
}

// ---------------------------------------------------------------------------
// Cal.com stats — GET /v1/calcom/stats
// ---------------------------------------------------------------------------

export interface CalcomEventTypeStats {
  slug: string
  label: string
  count: number
}

export interface CalcomStats {
  total: number
  upcoming: number
  completed: number
  cancelled: number
  no_show: number
  by_event_type: CalcomEventTypeStats[]
}

export interface CalcomStatsResponse {
  ok: boolean
  connected: boolean
  stats: CalcomStats | null
}

export async function getCalcomStats(): Promise<CalcomStatsResponse> {
  return apiGet<CalcomStatsResponse>('/v1/calcom/stats')
}

// ---------------------------------------------------------------------------
// Support tickets — GET /v1/support/tickets/by-account/:account_id
//                   POST /v1/support/tickets
// ---------------------------------------------------------------------------

export interface SupportTicketRow {
  ticket_id: string
  account_id: string
  subject: string
  message?: string
  priority?: string | null
  status: string
  category?: string | null
  created_at: string
  updated_at?: string | null
}

export async function getSupportTicketsByAccount(
  accountId: string
): Promise<SupportTicketRow[]> {
  const data = await apiGet<{ ok: boolean; tickets: SupportTicketRow[] }>(
    `/v1/support/tickets/by-account/${accountId}`
  )
  return data.tickets ?? []
}

export interface CreateSupportTicketInput {
  accountId: string
  subject: string
  message: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  ticketId?: string
}

export async function createSupportTicket(
  input: CreateSupportTicketInput
): Promise<{ ok: boolean; ticketId?: string; message?: string }> {
  return apiPost<{ ok: boolean; ticketId?: string; message?: string }>(
    `/v1/support/tickets`,
    input
  )
}

// ---------------------------------------------------------------------------
// Affiliate — GET /v1/affiliates/:account_id
//             GET /v1/affiliates/:account_id/events
// ---------------------------------------------------------------------------

export interface AffiliateRecord {
  referral_code: string
  connect_status: 'pending' | 'active' | 'inactive' | string
  balance_pending: number
  balance_paid: number
  referral_url: string
  referred_count: number
}

export async function getAffiliate(accountId: string): Promise<AffiliateRecord> {
  const data = await apiGet<{ ok: boolean; affiliate: AffiliateRecord }>(
    `/v1/affiliates/${accountId}`
  )
  return data.affiliate
}

export interface AffiliateEventRow {
  event_id: string
  referrer_account_id: string
  referred_account_id?: string
  platform?: string
  gross_amount_cents?: number
  commission_amount_cents?: number
  status: 'pending' | 'paid' | string
  created_at: string
}

export async function getAffiliateEvents(
  accountId: string,
  limit = 20
): Promise<AffiliateEventRow[]> {
  const data = await apiGet<{ ok: boolean; events: AffiliateEventRow[] }>(
    `/v1/affiliates/${accountId}/events?limit=${limit}`
  )
  return data.events ?? []
}

// ---------------------------------------------------------------------------
// Accounts — GET /v1/accounts/:account_id
//            GET /v1/memberships/by-account/:account_id
// ---------------------------------------------------------------------------

export interface AccountRow {
  account_id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  platform?: string | null
  status?: string | null
  created_at?: string | null
  updated_at?: string | null
  two_factor_enabled?: number | boolean | null
}

export async function getAccount(accountId: string): Promise<AccountRow> {
  const data = await apiGet<{ ok: boolean; account: AccountRow }>(
    `/v1/accounts/${accountId}`
  )
  return data.account
}

export interface MembershipRow {
  membership_id: string
  account_id: string
  plan_key: string
  status: string
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  created_at?: string
  updated_at?: string | null
}

export async function getMembershipByAccount(
  accountId: string
): Promise<MembershipRow | null> {
  const data = await apiGet<{ ok: boolean; membership: MembershipRow | null }>(
    `/v1/memberships/by-account/${accountId}`
  )
  return data.membership
}

// ---------------------------------------------------------------------------
// Profiles — GET /v1/profiles/:professional_id
// ---------------------------------------------------------------------------

export async function getProfile(professionalId: string): Promise<Record<string, unknown>> {
  const data = await apiGet<{ ok: boolean; profile: Record<string, unknown> }>(
    `/v1/profiles/${professionalId}`
  )
  return data.profile
}
