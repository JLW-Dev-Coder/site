# Current Phase

## Completed: Phase 3 — Affiliate Program (2026-03-30)

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
- ✅ 2.1: VLP architecture review / gap analysis
- ✅ 2.2: 10 missing routes built (tokens, reports, email, purchases, pricing)
- ✅ 2.3: D1 migration applied (0017_ttmp_reports.sql)
- ✅ 2.4: All 24 TTMP routes live in VLP Worker
- ✅ 2.5: Frontend updated — all API calls pointing to VLP
- ✅ 2.6: Legacy Worker deleted from repo and Cloudflare
- ✅ 2.7: TTMP migration fully complete (2026-03-29)

### Migration Progress Notes
TTTMP (taxtools.taxmonitor.pro) — ✅ Complete 2026-03-29
- 13 backend routes in VLP
- Next.js frontend with Amber Gold (#f59e0b) theme
- Static games preserved in public/
- PayPal and ClickUp removed
- D1 and legacy Worker deleted

## Phase 4: Token Purchase Flow & Membership Gating (IN PROGRESS)

### Objective
Wire token purchase flow to membership gating. Subscription renewals auto-grant tokens based on plan tier. One-time token purchases available. Form tools free with any paid subscription.

### Business Rules
**Token Types:**
- transcript_tokens — TTMP transcript analysis (1 per analysis)
- tax_game_tokens — TTTMP game plays (1 per play)

**Token Purchase Packages:**
- TTTMP: 30 tokens/$9, 80 tokens/$19, 200 tokens/$39
- TTMP: 10 tokens/$19, 25 tokens/$29, 100 tokens/$129

**Monthly Token Grants by Subscription (on invoice.payment_succeeded):**
- VLP Free: 0/0
- VLP Starter ($79): 30 tax_game + 30 transcript
- VLP Scale ($199): 120 tax_game + 100 transcript
- VLP Advanced ($399): 300 tax_game + 250 transcript
- TMP Essential ($9): 5 tax_game + 2 transcript
- TMP Plus ($19): 15 tax_game + 5 transcript
- TMP Premier ($39): 40 tax_game + 10 transcript
- TMP Bronze ($275): 5 tax_game + 5 transcript
- TMP Silver ($325): 10 tax_game + 10 transcript
- TMP Gold ($425): 20 tax_game + 20 transcript
- TMP Snapshot ($425): 0 tax_game + 1 transcript

**Feature Gating:**
- Transcript analysis (POST /v1/tools/transcript-parser): requires transcript_tokens >= 1
- TTTMP game plays: requires tax_game_tokens >= 1
- TTTMP form tools (2848/8821): free with any paid subscription, no token cost
- When balance = 0: return { ok: false, error: 'INSUFFICIENT_TOKENS', tokens_remaining: 0, upgrade_url: '/pricing' } with HTTP 402

### Phase 4 Checklist
- ✅ 4.0: Token grants wired to Stripe webhook invoice.payment_succeeded
- ✅ 4.1: Token purchase credit wired to checkout.session.completed
- ✅ 4.2: Form tool membership gate added (POST /v1/tools/form2848, form-8821)
- ✅ 4.3: Token consumption removed from form tools (free with paid subscription)
- ✅ 4.4: Transcript parser token gate verified/updated to standard error format
- ✅ 4.5: POST /v1/tokens/purchase route added
- ✅ 4.6: GET /v1/tokens/balance/:account_id verified (already existed)
- ✅ 4.7: GET /v1/tokens/pricing route added
- ✅ 4.8: PHASE.md updated

### Implementation Notes
- TTMP token price IDs flagged as missing from wrangler.toml (placeholders used)
- Token grants process after affiliate commission in webhook
- Form tools no longer consume tokens for paid subscribers

---

## Completed: Phase 3 — Affiliate Program (2026-03-30)

### Objective
Ecosystem-wide affiliate program. Every VLP account gets a
referral code. When a referred account makes any purchase
on any platform, the referrer earns 20% commission for life.
Cash payouts via Stripe Connect Express.

### Configuration (already in wrangler.toml)
AFFILIATE_COMMISSION_RATE = "0.20"
STRIPE_CONNECT_CLIENT_ID = "ca_UEvTMDrQCV82RNrJ4JIaEye4bimUM0RX"

### Stripe Setup (already complete)
- Connect enabled on VLP Stripe account
- Redirect URI registered:
  https://api.virtuallaunch.pro/v1/affiliates/connect/callback
- Express accounts confirmed as correct account type

### Routes to Build (6 routes)
- POST /v1/affiliates/connect/onboard
- GET  /v1/affiliates/connect/callback
- GET  /v1/affiliates/{account_id}
- GET  /v1/affiliates/{account_id}/events
- POST /v1/affiliates/payout/request
- GET  /v1/affiliates/payout/{payout_id}

### Contracts to Create (6 contracts)
All in contracts/vlp/ — affiliate program is VLP core,
not platform-specific.
- vlp.affiliate.onboard.v1.json
- vlp.affiliate.callback.v1.json
- vlp.affiliate.get.v1.json
- vlp.affiliate.events.v1.json
- vlp.affiliate.payout.request.v1.json
- vlp.affiliate.payout.get.v1.json

### R2 Storage Pattern
/r2/affiliates/{account_id}.json
/r2/affiliate_events/{event_id}.json
/r2/affiliate_payouts/{payout_id}.json

### Commission Trigger
Hooks into existing POST /v1/webhooks/stripe handler.
On INVOICE_PAID → check referred_by on account →
write commission event → update affiliate balance.

### Phase 3 Checklist
- ✅ 3.0: Referral code generated at account creation
- ✅ 3.1: POST /v1/affiliates/connect/onboard
- ✅ 3.2: GET  /v1/affiliates/connect/callback
- ✅ 3.3: GET  /v1/affiliates/{account_id} dashboard data
- ✅ 3.4: GET  /v1/affiliates/{account_id}/events history
- ✅ 3.5: POST /v1/affiliates/payout/request
- ✅ 3.6: GET  /v1/affiliates/payout/{payout_id}
- ✅ 3.7: Stripe webhook updated for commission on INVOICE_PAID
- ✅ 3.8: Referral link landing page (virtuallaunch.pro/ref/{code})
- ❌ 3.9: Affiliate dashboard UI (platform frontend TBD)

### Business Model Reminder
TTMP token packages:
- 10 tokens = $19
- 25 tokens = $29
- 100 tokens = $129
One token = one transcript analysis = one client report
