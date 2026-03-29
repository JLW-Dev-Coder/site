# Current Phase

## Active: Phase 2 — TTMP Transcript Dashboard

### What We're Building
Tax professionals upload IRS transcript PDFs and receive
plain-English analysis reports. Token-gated (1 token per analysis).

### User Journey
1. Professional logs in via magic link
2. Uploads client IRS transcript PDF
3. System extracts transaction data (free, no token cost)
4. Professional reviews extraction preview
5. Professional clicks Analyze (costs 1 token)
6. System generates report with code explanations + recommendations
7. Professional views, prints, or emails report to client

### Two-Step Technical Flow
Step 1 — Upload (FREE):
  POST /v1/transcripts/upload
  Input: PDF file
  Output: { job_id, extracted_data, preview }

Step 2 — Analyze (1 TOKEN):
  POST /v1/tools/transcript-parser
  Input: extracted_data from Step 1
  Output: { report, event_id, tokens_remaining }

### Phase 2 Checklist
- ✅ 2.0: PDF upload route built (POST /v1/transcripts/upload)
- ✅ 2.1: VLP architecture review / gap analysis (86 routes, 58% TTMP coverage found)
- ✅ 2.2: 10 missing routes built (tokens, reports, email, purchases, pricing)
- ✅ 2.3: D1 migration applied (0017_ttmp_reports.sql)
- ✅ 2.4: All 24 TTMP routes now live in VLP Worker
- 🔄 2.5: TTMP frontend pages (active — switching to transcript.taxmonitor.pro)
- ❌ 2.6: Frontend pointed at VLP API
- ❌ 2.7: Legacy TTMP Worker deleted from repo and Cloudflare

### What Phase 3 Looks Like (After Phase 2 Complete)
Affiliate program — ecosystem-wide, built entirely in VLP:
- Stripe Connect Express onboarding for affiliates
- Referral code generation at account creation
- Lifetime commission tracking (20% flat, all platforms)
- Cash payouts via Stripe Connect transfers
- Dashboard showing referral stats and earnings

### Business Model Reminder
TTMP token packages:
- 10 tokens = $19
- 25 tokens = $29
- 100 tokens = $129
One token = one transcript analysis = one client report
