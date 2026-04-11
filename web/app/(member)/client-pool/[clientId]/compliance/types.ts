export type FilingStatus = 'HOH' | 'MFJ' | 'MFS' | 'SINGLE' | ''
export type RecordStatus = 'Draft' | 'Final'
export type TabId =
  | 'overview'
  | 'agent'
  | 'authority'
  | 'compliance'
  | 'notices'
  | 'installment'
  | 'revenue'
  | 'transcripts'
  | 'summary'

export interface NoticeEntryData {
  received: string
  date: string
  type: string
  cp_number: string
  details: string
}

export interface ComplianceData {
  account_id: string
  order_id: string
  servicing_professional_id: string
  source: 'staff_compliance_records'

  client_name: string
  ssn_full: string
  ssn_last4: string
  filing_status: FilingStatus
  state_of_residence: string

  total_irs_balance: string
  irs_penalties_total: string
  irs_interest_total: string
  irs_account_status: string
  estimated_balance_due_range: string
  irs_missing_years: string
  unfiled_returns_indicator: string
  irs_lien_exposure_level: string
  irs_status_categories: string[]

  irs_agent_department: string
  irs_agent_department_phone: string
  irs_call_confirmation_date: string
  irs_representative_name: string
  irs_representative_badge_number: string
  irs_call_discussion_notes: string
  irs_call_action_items: string

  agent_name: string
  caf_number: string
  ptin: string
  poa_effective_date: string
  tax_matters_authorized: string

  auth_receive_tax_info: boolean
  auth_represent_taxpayer: boolean
  auth_sign_return: boolean
  auth_receive_refund: boolean

  compliance_tax_year: number
  compliance_activity_type: string
  compliance_period_covered: string
  compliance_internal_notes: string

  return_processing_status: string
  return_date_filed: string
  return_filing_status: FilingStatus
  return_tax_liability: string

  notices: NoticeEntryData[]

  ia_established: string
  ia_payment_amount: string
  ia_payment_date: string
  ia_last_payment_amount: string
  ia_last_payment_date: string

  ro_name: string
  ro_phone: string
  ro_mobile_phone: string
  ro_email: string
  ro_fax: string
  ro_notes: string

  transcript_request_made: boolean
  transcript_delivery_method: string
  transcript_scope_confirmed: string
  transcripts_retrieved_from_sor: string
  transcript_retrieval_date: string
  transcript_retrieval_notes: string
  transcript_types: string[]

  compliance_client_summary: string
  compliance_internal_next_steps: string
  compliance_record_status: RecordStatus
  compliance_prepared_date: string
  compliance_included_sections: string[]
}

export function emptyNotice(): NoticeEntryData {
  return { received: '', date: '', type: '', cp_number: '', details: '' }
}

export function initialComplianceData(): ComplianceData {
  return {
    account_id: 'ACCT_8a14-margaret-chen',
    order_id: 'TC-2024-00847',
    servicing_professional_id: 'PRO_james-morrison-ea',
    source: 'staff_compliance_records',

    client_name: 'Margaret Chen',
    ssn_full: '123-45-4827',
    ssn_last4: '4827',
    filing_status: 'SINGLE',
    state_of_residence: 'California',

    total_irs_balance: '$24,847.32',
    irs_penalties_total: '$3,218.00',
    irs_interest_total: '$1,842.17',
    irs_account_status: 'Non-Compliant',
    estimated_balance_due_range: '$10,000–$25,000',
    irs_missing_years: 'Missing within 10-year window',
    unfiled_returns_indicator: 'Yes',
    irs_lien_exposure_level: 'Moderate — balance or status requires monitoring',
    irs_status_categories: ['Collection', 'Notice'],

    irs_agent_department: 'IRS Collection Department',
    irs_agent_department_phone:
      'IRS Practitioner Priority Service — Individual — (800) 477-4580',
    irs_call_confirmation_date: '2024-12-12',
    irs_representative_name: 'Agent Peterson',
    irs_representative_badge_number: '1001234567',
    irs_call_discussion_notes:
      'Confirmed balance for TY2022 and TY2023. Client has not responded to CP504. Discussed IA options.',
    irs_call_action_items:
      'Submit IA request via Form 9465 by 01/20. Follow up on CP2000 response due 02/15.',

    agent_name: 'James Morrison, EA',
    caf_number: '1234-56789-R',
    ptin: 'P00123456',
    poa_effective_date: '2024-01-15',
    tax_matters_authorized: 'Income Tax (1040) — Years 2020, 2021, 2022, 2023, 2024',

    auth_receive_tax_info: true,
    auth_represent_taxpayer: true,
    auth_sign_return: false,
    auth_receive_refund: false,

    compliance_tax_year: new Date().getFullYear(),
    compliance_activity_type: 'Filing compliance review',
    compliance_period_covered: 'Initial 10-year review',
    compliance_internal_notes:
      'Client has two years of unfiled returns and an active CP504. Priority: get POA on file, pull transcripts, propose IA.',

    return_processing_status: 'Filed - Accepted',
    return_date_filed: '2024-04-15',
    return_filing_status: 'SINGLE',
    return_tax_liability: '$28,340',

    notices: [
      {
        received: 'Yes',
        date: '2024-12-14',
        type: 'CP (Computer Paragraph Notice)',
        cp_number: 'CP504',
        details:
          'Notice of Intent to Levy — $24,847.32 balance due. Response deadline Jan 28, 2025.',
      },
      {
        received: 'Yes',
        date: '2024-11-20',
        type: 'CP (Computer Paragraph Notice)',
        cp_number: 'CP2000',
        details:
          'Underreported income flagged on TY2023. Proposed adjustment $4,218. Response deadline Feb 15, 2025.',
      },
      {
        received: 'Yes',
        date: '2024-08-15',
        type: 'CP (Computer Paragraph Notice)',
        cp_number: 'CP14',
        details: 'Balance due notice TY2022. Paid in full Oct 1, 2024.',
      },
    ],

    ia_established: 'No',
    ia_payment_amount: '',
    ia_payment_date: '',
    ia_last_payment_amount: '',
    ia_last_payment_date: '',

    ro_name: '',
    ro_phone: '',
    ro_mobile_phone: '',
    ro_email: '',
    ro_fax: '',
    ro_notes: '',

    transcript_request_made: true,
    transcript_delivery_method: 'Secure mailbox (SOR)',
    transcript_scope_confirmed: 'Full 10-year access',
    transcripts_retrieved_from_sor: 'Yes',
    transcript_retrieval_date: '2024-12-15',
    transcript_retrieval_notes:
      'Pulled Account + Record of Account transcripts for TY2015-2024 via SOR.',
    transcript_types: ['Account Transcript', 'Record of Account'],

    compliance_client_summary:
      'Your IRS account currently shows a balance of $24,847.32 across 2022 and 2023. We\'ve pulled transcripts, confirmed your filing status, and identified the active CP504 as the highest priority. Our next step is to submit an Installment Agreement request so collection activity is paused while we work through the CP2000 response.',
    compliance_internal_next_steps:
      'File Form 9465 for IA by 01/20. Draft CP2000 response by 02/01. Re-pull wage & income transcripts for TY2023.',
    compliance_record_status: 'Draft',
    compliance_prepared_date: new Date().toISOString().slice(0, 10),
    compliance_included_sections: ['Account Status', 'Call Notes', 'Notices', 'Transcripts'],
  }
}

export const FILING_STATUS_OPTIONS: Array<{ value: FilingStatus; label: string }> = [
  { value: 'HOH', label: 'Head of Household' },
  { value: 'MFJ', label: 'Married Filing Jointly' },
  { value: 'MFS', label: 'Married Filing Separately' },
  { value: 'SINGLE', label: 'Single' },
]

export const IRS_ACCOUNT_STATUS_OPTIONS = [
  'Compliant',
  'Limited Compliance',
  'Non-Compliant',
  'Unknown',
]

export const ESTIMATED_BALANCE_RANGE_OPTIONS = [
  'Under $10,000',
  '$10,000–$25,000',
  '$25,001–$50,000',
  'Over $50,000',
  'Unknown',
]

export const IRS_MISSING_YEARS_OPTIONS = [
  'All years filed',
  'Missing within 10-year window',
  'Missing prior to 10-year window',
  'Unable to confirm',
]

export const UNFILED_RETURNS_OPTIONS = ['Yes', 'No', 'Unsure']

export const IRS_LIEN_EXPOSURE_OPTIONS = [
  'Low — compliant or protected status',
  'Moderate — balance or status requires monitoring',
  'High — lien filed or filing imminent',
  'Unknown — insufficient IRS confirmation',
]

export const IRS_STATUS_CATEGORY_OPTIONS = [
  'Audit',
  'Collection',
  'Installment Agreement',
  'Notice',
  'OIC',
  'Pending collection',
  'RO assigned',
  'None identified',
]

export const IRS_AGENT_DEPARTMENT_OPTIONS = [
  'IRS Administration Department 1040/PPS',
  'IRS Appeals Department',
  'IRS Collection Department',
  'IRS Examination Department',
]

export const IRS_AGENT_DEPARTMENT_PHONE_OPTIONS = [
  'IRS Automated Collections System — Business — (800) 231-3903',
  'IRS Correspondence Examination — Individual — (800) 597-4347',
  'IRS e-Help Desk (e-Services) — (800) 673-4348',
  'IRS General Line — (844) 959-1040',
  'IRS Identity Verification — (800) 975-5084',
  'IRS International Line — (877) 298-6617',
  'IRS OIC Brookhaven (Holtsville) — (800) 803-4980',
  'IRS Practitioner Priority Service — Business — (800) 347-7801',
  'IRS Practitioner Priority Service — Individual — (800) 477-4580',
  'IRS Tax Exempt — (877) 755-7781',
  'IRS Underreporter — Individual — (800) 868-8209',
]

export const COMPLIANCE_ACTIVITY_TYPE_OPTIONS = [
  'Filing compliance review',
  'IRS account verification',
  'IRS notice review',
  'IRS transcript request',
  'Status confirmation',
]

export const COMPLIANCE_PERIOD_COVERED_OPTIONS = [
  'Current month',
  'Initial 10-year review',
  'Prior quarter',
  'Prior tax year',
  'Rolling review',
  'Specific IRS notice period',
]

export const RETURN_PROCESSING_STATUS_OPTIONS = [
  'Extension Filed',
  'Filed - Accepted',
  'Filed - Under Review',
  'Not Filed',
]

export const NOTICE_RECEIVED_OPTIONS = ['Yes', 'No']

export const NOTICE_TYPE_OPTIONS = [
  'CP (Computer Paragraph Notice)',
  'LT (Long Term Notice)',
  'Other (IRS Letter)',
  'Unknown (Notice Type Unknown)',
]

export const NOTICE_CP_NUMBER_OPTIONS = [
  'CP14',
  'CP71',
  'CP90',
  'CP91',
  'CP92',
  'CP501',
  'CP503',
  'CP504',
  'CP523',
  'CP2000',
  'No Number Indicated',
]

export const IA_ESTABLISHED_OPTIONS = ['Yes', 'No', 'Unable to confirm']

export const TRANSCRIPT_DELIVERY_OPTIONS = [
  'CAF mailbox',
  'Fax',
  'Online account',
  'Pending POA processing',
  'Secure mailbox (SOR)',
]

export const TRANSCRIPT_SCOPE_OPTIONS = [
  'Access denied',
  'Current year only',
  'Full 10-year access',
  'Partial access',
]

export const TRANSCRIPT_RETRIEVED_OPTIONS = ['Yes', 'No', 'Unknown']

export const TRANSCRIPT_TYPE_OPTIONS = [
  { value: 'Account Transcript', label: 'Account Transcript', sub: 'Payment history & balances' },
  { value: 'Return Transcript', label: 'Return Transcript', sub: 'Line items from filed return' },
  { value: 'Record of Account', label: 'Record of Account', sub: 'Combined return + account' },
  { value: 'Wage & Income', label: 'Wage & Income', sub: 'W-2s, 1099s received' },
]

export const INCLUDED_SECTION_OPTIONS = [
  'Account Status',
  'Call Notes',
  'Notices',
  'Transcripts',
]

export const STATE_OPTIONS = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
  'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming',
]
