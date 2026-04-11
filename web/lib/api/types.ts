// ---------------------------------------------------------------------------
// API response types — shapes mirror the canonical contracts in /contracts/
// Update these types as contracts evolve; do NOT invent fields.
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  tokensRemaining: number
  tokensTotal: number
  upcomingBookings: number
  openTickets: number
  membership: string
  renewalDate: string
}

// GET /v1/dashboard — aggregate payload for the member dashboard page
export interface DashboardActivity {
  type: 'booking' | 'report' | 'support' | 'token' | string
  title: string
  timestamp: string
}

export interface DashboardUpcomingBooking {
  booking_id: string
  scheduled_at: string
  booking_type: string
  status: string
  professional_id: string
}

export interface DashboardPayload {
  account: {
    account_id: string
    email: string
    name: string
    credential: string | null
    platform: string
    professional_id: string | null
    tier: string
    plan_key: string
    plan_name: string
    tier_renewal_date: string | null
    member_since: string | null
  }
  tokens: {
    balance: number
    tax_game_balance: number
    monthly_allocation: number
    updated_at: string | null
  }
  bookings: {
    this_month: number
    upcoming: DashboardUpcomingBooking[]
  }
  reports: {
    generated_this_month: number
    pending_review: number
  }
  support: {
    open_tickets: number
    awaiting_response: number
  }
  client_pool: {
    assigned_cases: number
    available_cases: number
  }
  activity: DashboardActivity[]
}

export interface AccountProfile {
  accountId: string
  email: string
  firstName: string
  lastName: string
  phone?: string
  timezone?: string
  status: 'active' | 'archived' | 'disabled' | 'pending'
  platform: 'dvlp' | 'gvlp' | 'tcvlp' | 'tmp' | 'ttmp' | 'tttmp' | 'vlp' | 'wlvlp'
  role: 'admin' | 'member' | 'professional' | 'taxpayer'
  twoFactorEnabled: boolean
  createdAt: string
}

export interface NotificationPreferences {
  accountId: string
  inAppEnabled: boolean
  smsEnabled: boolean
}

export interface VlpPreferences {
  accountId: string
  appearance: 'dark' | 'light' | 'system'
  timezone?: string
  defaultDashboard?: string
  accentColor?: string
}

export interface Booking {
  bookingId: string
  accountId: string
  professionalId: string
  bookingType: 'demo_intro' | 'support'
  scheduledAt: string
  timezone: string
  status: 'cancelled' | 'completed' | 'confirmed' | 'pending' | 'rescheduled'
}

export interface Receipt {
  invoiceId: string
  accountId: string
  amount: number
  currency: string
  status: string
  createdAt: string
  receiptUrl?: string
}

export interface SupportTicket {
  ticketId: string
  accountId: string
  subject: string
  message: string
  priority: 'high' | 'low' | 'normal' | 'urgent'
  status: 'closed' | 'in_progress' | 'open' | 'reopened' | 'resolved'
  createdAt: string
}

export interface TokenBalance {
  accountId: string
  taxGameTokens: number
  transcriptTokens: number
  updatedAt: string
}

export interface TokenUsageEntry {
  eventId: string
  accountId: string
  tokenType: 'tax_game' | 'transcript'
  amount: number
  action: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Tools — Form 2848 / 8821
// ---------------------------------------------------------------------------

export interface TaxMatter {
  taxType: string
  formNumber: string
  yearOrPeriod: string
}

export interface Form2848Payload {
  eventId: string
  taxpayerName: string
  taxpayerTin: string
  taxpayerAddress: string
  taxpayerPhone?: string
  representativeName: string
  representativeCafNumber?: string
  representativePtin?: string
  representativeAddress: string
  representativePhone?: string
  taxMatters: TaxMatter[]
}

export interface Form8821Payload {
  eventId: string
  taxpayerName: string
  taxpayerTin: string
  taxpayerAddress: string
  taxpayerPhone?: string
  appointeeName: string
  appointeeCafNumber?: string
  appointeeAddress: string
  appointeePhone?: string
  taxMatters: TaxMatter[]
  specificUseNotRecorded?: boolean
}

export interface ToolResult {
  eventId: string
  status: 'completed'
  tokensDebited: number
  tokenType: 'tax_game'
  formData: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export type TranscriptType = 'account' | 'record_of_account' | 'return' | 'wage_and_income'

export interface TranscriptJobPayload {
  eventId: string
  transcriptText: string
  transcriptType: TranscriptType
  taxYear?: number
}

export interface TranscriptResult {
  jobId: string
  transcriptType: TranscriptType
  taxYear: number | null
  parsedAt: string
  extractedFields: {
    tins: string[]
    dates: string[]
    amounts: string[]
    cycles: string[]
    accountBalance: string | null
    withheld: string | null
  }
  lineCount: number
  charCount: number
}

export interface TranscriptJob {
  jobId: string
  transcriptType: TranscriptType
  taxYear: number | null
  status: 'completed' | 'failed' | 'pending' | 'processing'
  tokensDebited: number
  createdAt: string
  completedAt: string | null
  result: TranscriptResult | null
}

export interface TranscriptJobHistoryEntry {
  job_id: string
  transcript_type: TranscriptType
  tax_year: number | null
  status: 'completed' | 'failed' | 'pending' | 'processing'
  created_at: string
  completed_at: string | null
}

export interface ApiError {
  code: string
  message: string
}

// ---------------------------------------------------------------------------
// Affiliates
// ---------------------------------------------------------------------------

export interface AffiliateData {
  referral_code: string
  connect_status: 'active' | 'inactive' | 'pending'
  balance_pending: number
  balance_paid: number
  referral_url: string
}

export interface AffiliateEvent {
  platform: string
  gross_amount: number
  commission_amount: number
  status: 'pending' | 'paid'
  created_at: string
}

export interface AffiliateOnboardingResponse {
  onboard_url: string
}

export interface PayoutResponse {
  payout_id: string
  amount: number
  status: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }
