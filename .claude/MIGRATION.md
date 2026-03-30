# Migration Tracker

## Purpose
Track the status of migrating each platform's legacy standalone
Worker into VLP. Updated as work completes.

## Migration Pattern (Same For Every Platform)

1. AUDIT — Read the legacy Worker file, list all routes
2. MAP — For each route, find or plan the VLP equivalent
3. PORT — Build missing VLP routes (contracts + handlers)
4. VERIFY — Confirm VLP routes work correctly
5. UPDATE FRONTEND — Point platform frontend to VLP API
6. DELETE — Remove Worker from repo and Cloudflare dashboard
7. UPDATE THIS FILE — Mark platform as complete

## Platform Status

### TTMP (transcript.taxmonitor.pro)
Status: ✅ MIGRATION COMPLETE (2026-03-29)
Legacy Worker: transcript-tax-monitor-pro
Backend: ✅ All 24 routes live in VLP Worker
Frontend: ✅ All API calls pointing to api.virtuallaunch.pro
Repo: ✅ workers/ directory deleted
Cloudflare: ✅ Worker deleted from dashboard
Notes:
- TokenLedger Durable Object replaced by VLP R2+D1 token system
- KV_TRANSCRIPT and R2_TRANSCRIPT bindings retired
- tm_transcript_session cookie replaced by VLP session system
- D1 migration 0017_ttmp_reports.sql applied to production

### TTTMP (taxtools.taxmonitor.pro)
Status: ✅ MIGRATION COMPLETE (2026-03-29)
Legacy Worker: taxtools-taxmonitor-pro-api
Backend: ✅ 13 routes live in VLP Worker
Frontend: ✅ Next.js 15 — all pages converted to TSX
Repo: ✅ workers/ directory deleted
Cloudflare Worker: ✅ Deleted from dashboard
Cloudflare D1: ✅ Deleted (tax-tools-tax-monitor — test data)
Next.js accent: #f59e0b Amber Gold

Key decisions made:
- PayPal removed — Stripe replaces for all payments
- ClickUp removed — VLP support system used instead
- Games stay as static HTML in public/games/ (untouched)
- about-games converted to Next.js dynamic route
- lib/games.ts is shared data source for games pages
- tokenCost fixed from 8 → 1 per game play

Stripe products:
- prod_UExej9awY6pNCe (Tax Tools Arcade Token Pack)
- price_1TGTiqQEa4WBi79guSRnECvw ($9 / 30 tokens)
- price_1TGTiqQEa4WBi79gScrpsUab ($19 / 80 tokens)
- price_1TGTiqQEa4WBi79gpTsbsLIi ($39 / 200 tokens)

### TMP (taxmonitor.pro)
Status: Not Yet Audited
Action: Read workers/src/index.js in tmp repo when switching to that repo

### DVLP (developers.virtuallaunch.pro)
Status: Not Yet Audited

### GVLP (games.virtuallaunch.pro)
Status: Not Yet Audited

### WLVLP (websitelotto.virtuallaunch.pro)
Status: Not Yet Audited

### TCVLP (taxclaim.virtuallaunch.pro)
Status: Not Yet Audited

## Affiliate System (VLP Core — Not A Migration)
Status: Not Started
This is new infrastructure, not a migration. Build in VLP from scratch.
Planned routes:
- POST /v1/affiliates/connect/onboard
- GET  /v1/affiliates/connect/callback
- GET  /v1/affiliates/{account_id}
- GET  /v1/affiliates/{account_id}/events
- POST /v1/affiliates/payout/request
- GET  /v1/affiliates/payout/{payout_id}
Config: AFFILIATE_COMMISSION_RATE = 0.20 (in wrangler.toml [vars])
Payout: Stripe Connect Express accounts
Attribution: Lifetime (every purchase, every platform, forever)
