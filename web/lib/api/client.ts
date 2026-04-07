/**
 * VLP API client — talks to the Cloudflare Worker backend.
 *
 * WORKER URL is set via NEXT_PUBLIC_API_URL env var.
 * During local dev without a live Worker, MOCK_API=true returns fixture data.
 */

import type {
  DashboardSummary,
  AccountProfile,
  NotificationPreferences,
  VlpPreferences,
  Booking,
  Receipt,
  SupportTicket,
  TokenBalance,
  TokenUsageEntry,
  Form2848Payload,
  Form8821Payload,
  ToolResult,
  TranscriptJobPayload,
  TranscriptJob,
  TranscriptJobHistoryEntry,
  AffiliateData,
  AffiliateEvent,
  AffiliateOnboardingResponse,
  PayoutResponse,
  ApiResult,
} from './types'
import { getSessionToken } from '../auth/session'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''
const USE_MOCK = process.env.NEXT_PUBLIC_MOCK_API === 'true' || !API_URL

// ---------------------------------------------------------------------------
// Base fetch wrapper
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, error: { code: String(res.status), message: body?.message ?? res.statusText } }
    }

    const data = (await res.json()) as T
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: String(err) } }
  }
}

function getAuthHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

// ---------------------------------------------------------------------------
// Mock fixtures — replace with real Worker calls when backend is live
// ---------------------------------------------------------------------------

const MOCK_DASHBOARD: DashboardSummary = {
  tokensRemaining: 84_500,
  tokensTotal: 100_000,
  upcomingBookings: 3,
  openTickets: 0,
  membership: 'pro',
  renewalDate: 'Apr 1, 2026',
}

const MOCK_ACCOUNT: AccountProfile = {
  accountId: 'mock-user-1',
  email: 'user@example.com',
  firstName: 'Demo',
  lastName: 'User',
  phone: '+1 555-000-0000',
  timezone: 'America/New_York',
  status: 'active',
  platform: 'vlp',
  role: 'member',
  twoFactorEnabled: false,
  createdAt: '2025-01-01T00:00:00Z',
}

const MOCK_NOTIFICATION_PREFS: NotificationPreferences = {
  accountId: 'mock-user-1',
  inAppEnabled: true,
  smsEnabled: false,
}

const MOCK_VLP_PREFS: VlpPreferences = {
  accountId: 'mock-user-1',
  appearance: 'system',
  timezone: 'America/New_York',
}

const MOCK_BOOKINGS: Booking[] = [
  {
    bookingId: 'bk-001',
    accountId: 'mock-user-1',
    professionalId: 'pro-001',
    bookingType: 'demo_intro',
    scheduledAt: '2026-04-10T14:00:00Z',
    timezone: 'America/New_York',
    status: 'confirmed',
  },
  {
    bookingId: 'bk-002',
    accountId: 'mock-user-1',
    professionalId: 'pro-002',
    bookingType: 'support',
    scheduledAt: '2026-03-01T10:00:00Z',
    timezone: 'America/New_York',
    status: 'completed',
  },
]

const MOCK_RECEIPTS: Receipt[] = [
  {
    invoiceId: 'inv-001',
    accountId: 'mock-user-1',
    amount: 9900,
    currency: 'usd',
    status: 'paid',
    createdAt: '2026-03-01T00:00:00Z',
    receiptUrl: '#',
  },
  {
    invoiceId: 'inv-002',
    accountId: 'mock-user-1',
    amount: 9900,
    currency: 'usd',
    status: 'paid',
    createdAt: '2026-02-01T00:00:00Z',
    receiptUrl: '#',
  },
]

const MOCK_TICKETS: SupportTicket[] = [
  {
    ticketId: 'tkt-001',
    accountId: 'mock-user-1',
    subject: 'Cannot access transcript tool',
    message: 'Getting a 403 when I click the transcript link.',
    priority: 'normal',
    status: 'open',
    createdAt: '2026-03-10T09:00:00Z',
  },
]

const MOCK_TOKEN_BALANCE: TokenBalance = {
  accountId: 'mock-user-1',
  taxGameTokens: 5_000,
  transcriptTokens: 79_500,
  updatedAt: '2026-03-17T00:00:00Z',
}

const MOCK_TOKEN_USAGE: TokenUsageEntry[] = [
  {
    eventId: 'evt-001',
    accountId: 'mock-user-1',
    tokenType: 'transcript',
    amount: 500,
    action: 'transcript_generated',
    createdAt: '2026-03-16T15:00:00Z',
  },
  {
    eventId: 'evt-002',
    accountId: 'mock-user-1',
    tokenType: 'tax_game',
    amount: 100,
    action: 'tax_game_session',
    createdAt: '2026-03-15T11:00:00Z',
  },
]

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

export async function getDashboardSummary(): Promise<DashboardSummary> {
  if (USE_MOCK) return MOCK_DASHBOARD
  throw new Error('Dashboard summary: no single Worker endpoint yet — compose from accounts + memberships + tokens when Worker is live')
}

export async function getAccountProfile(accountId: string): Promise<AccountProfile> {
  if (USE_MOCK) return MOCK_ACCOUNT

  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<AccountProfile>(`/v1/accounts/${accountId}`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export async function getNotificationPreferences(accountId: string): Promise<NotificationPreferences> {
  if (USE_MOCK) return MOCK_NOTIFICATION_PREFS

  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<NotificationPreferences>(`/v1/notifications/preferences/${accountId}`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export async function getVlpPreferences(accountId: string): Promise<VlpPreferences> {
  if (USE_MOCK) return MOCK_VLP_PREFS

  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<VlpPreferences>(`/v1/vlp/preferences/${accountId}`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export async function getBookingsByAccount(accountId: string): Promise<Booking[]> {
  if (USE_MOCK) return MOCK_BOOKINGS

  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<{ ok: boolean; bookings: Booking[] }>(`/v1/bookings/by-account/${accountId}`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data.bookings
}

export async function getReceiptsByAccount(accountId: string): Promise<Receipt[]> {
  if (USE_MOCK) return MOCK_RECEIPTS

  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<{ ok: boolean; receipts: Receipt[] }>(`/v1/billing/receipts/${accountId}`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data.receipts
}

export async function getSupportTicketsByAccount(accountId: string): Promise<SupportTicket[]> {
  if (USE_MOCK) return MOCK_TICKETS

  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<{ ok: boolean; tickets: SupportTicket[] }>(`/v1/support/tickets/by-account/${accountId}`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data.tickets
}

export async function getTokenBalance(accountId: string): Promise<TokenBalance> {
  if (USE_MOCK) return MOCK_TOKEN_BALANCE

  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<{ ok: boolean; balance: TokenBalance }>(`/v1/tokens/balance/${accountId}`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data.balance
}

export async function getTokenUsage(accountId: string): Promise<TokenUsageEntry[]> {
  if (USE_MOCK) return MOCK_TOKEN_USAGE

  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<{ ok: boolean; usage: TokenUsageEntry[] }>(`/v1/tokens/usage/${accountId}`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data.usage
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export async function submitForm2848(payload: Form2848Payload): Promise<ToolResult> {
  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<ToolResult>('/v1/tools/form-2848', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(payload),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export async function submitForm8821(payload: Form8821Payload): Promise<ToolResult> {
  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<ToolResult>('/v1/tools/form-8821', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(payload),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export async function submitTranscriptJob(payload: TranscriptJobPayload): Promise<TranscriptJob> {
  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<{ ok: boolean } & TranscriptJob>('/v1/transcripts/jobs', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(payload),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export async function getTranscriptJob(jobId: string): Promise<TranscriptJob> {
  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<TranscriptJob>(`/v1/transcripts/jobs/${jobId}`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export async function getTranscriptHistory(accountId: string): Promise<TranscriptJobHistoryEntry[]> {
  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<{ ok: boolean; jobs: TranscriptJobHistoryEntry[] }>(
    `/v1/tools/transcript-parser/history/${accountId}`,
    { headers: getAuthHeaders(token) }
  )
  if (!result.ok) throw new Error(result.error.message)
  return result.data.jobs
}

// ---------------------------------------------------------------------------
// Affiliates
// ---------------------------------------------------------------------------

export async function getAffiliate(accountId: string): Promise<AffiliateData> {
  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<{ ok: boolean; affiliate: AffiliateData }>(`/v1/affiliates/${accountId}`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data.affiliate
}

export async function getAffiliateEvents(accountId: string): Promise<AffiliateEvent[]> {
  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<{ ok: boolean; events: AffiliateEvent[] }>(`/v1/affiliates/${accountId}/events`, {
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data.events ?? []
}

export async function startAffiliateOnboarding(): Promise<AffiliateOnboardingResponse> {
  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<AffiliateOnboardingResponse>('/v1/affiliates/connect/onboard', {
    method: 'POST',
    headers: getAuthHeaders(token),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export async function requestPayout(amount: number): Promise<PayoutResponse> {
  const token = await getSessionToken()
  if (!token) throw new Error('No session token')

  const result = await apiFetch<PayoutResponse>('/v1/affiliates/payout/request', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify({ amount }),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}
