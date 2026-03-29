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
Status: 🔄 Frontend Migration In Progress
Legacy Worker: workers/src/index.js in transcript.taxmonitor.pro repo
Backend: ✅ Complete — all 24 routes live in VLP Worker
Frontend: ❌ Still pointing at legacy Worker
Next action: Update frontend API base URL to
  https://api.virtuallaunch.pro
  Then delete legacy Worker

### TTTMP (taxtools.taxmonitor.pro)
Status: Not Yet Audited
Action: Read workers/src/index.js in tttmp repo when switching to that repo

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
