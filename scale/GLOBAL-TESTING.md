# GLOBAL-TESTING.md — Email Pipeline System
**Repo:** virtuallaunch.pro
**Owner:** JLW
**Last updated:** 2026-04-08

---

## Objective

End-to-end validation of the automated email pipeline: enrichment, campaign routing, and 3-campaign send system (TTMP, VLP, WLVLP). Every test section maps to a deployed component. Run this checklist after any change to the pipeline, and weekly as a health check.

---

## Table of Contents

1. Prerequisites
2. Enrichment Pipeline (10:00 UTC cron)
3. Campaign Router (12:00 UTC cron)
4. TTMP Send Handler (14:00 UTC cron)
5. VLP Send Handler (14:00 UTC cron)
6. WLVLP Send Handler (14:00 UTC cron)
7. Gmail Integration
8. R2 Data Integrity
9. KV State Integrity
10. End-to-End Smoke Test
11. Monitoring Checklist (daily)
12. Known Limitations

---

## 1. Prerequisites

Before running any tests, confirm:

- [ ] Worker `virtuallaunch-pro-api` is deployed (check `wrangler deployments list`)
- [ ] Secrets set: `REOON_API_KEY`, `GOOGLE_PRIVATE_KEY` (full service account JSON), `INTERNAL_TEST_KEY`
- [ ] KV namespace `ENRICHMENT_KV` bound in wrangler.toml
- [ ] R2 bucket `virtuallaunch-pro` accessible
- [ ] Master lead file exists: `vlp-scale/foia-leads/foia-master.json` (NDJSON format)
- [ ] Gmail API enabled in GCP project
- [ ] Cron triggers active: `0 10 * * *`, `0 12 * * *`, `0 14 * * *`

### Test trigger commands

All test routes require header `X-Internal-Key: {INTERNAL_TEST_KEY value}`.

```bash
# Enrichment
curl -X POST https://api.virtuallaunch.pro/internal/test-enrichment -H "X-Internal-Key: enrichment-test-2026" --max-time 1800

# Daily batch generation / campaign router
curl -X POST https://api.virtuallaunch.pro/internal/test-daily-batch -H "X-Internal-Key: enrichment-test-2026" --max-time 300

# TTMP send
curl -X POST https://api.virtuallaunch.pro/internal/test-ttmp-send -H "X-Internal-Key: enrichment-test-2026" --max-time 1800

# VLP send
curl -X POST https://api.virtuallaunch.pro/internal/test-vlp-send -H "X-Internal-Key: enrichment-test-2026" --max-time 1800

# WLVLP send (existing route — confirm name with RC)
curl -X POST https://api.virtuallaunch.pro/internal/test-wlvlp-send -H "X-Internal-Key: enrichment-test-2026" --max-time 1800
```

### Check R2 objects

```bash
# Enrichment log
wrangler r2 object get virtuallaunch-pro/vlp-scale/enrichment-logs/{YYYY-MM-DD}.json --remote

# Batch log
wrangler r2 object get virtuallaunch-pro/vlp-scale/batch-logs/{YYYY-MM-DD}.json --remote

# Send queues
wrangler r2 object get virtuallaunch-pro/vlp-scale/ttmp-send-queue/email1-pending.json --remote
wrangler r2 object get virtuallaunch-pro/vlp-scale/vlp-send-queue/email1-pending.json --remote
wrangler r2 object get virtuallaunch-pro/vlp-scale/wlvlp-send-queue/email1-pending.json --remote

# Sent archives
wrangler r2 object get virtuallaunch-pro/vlp-scale/ttmp-send-queue/sent-{YYYY-MM-DD}.json --remote
```

### Check Reoon balance

```bash
curl.exe -i "https://emailverifier.reoon.com/api/v1/check-account-balance/?key={REOON_API_KEY}"
```

---

## 2. Enrichment Pipeline (10:00 UTC cron)

**Function:** `handleEnrichmentBatch(env)`
**Trigger:** `0 10 * * *` cron or `POST /internal/test-enrichment`

### Tests

- [ ] **2.1 — Master file loads** — Response includes `total_records` matching expected count (~88,497)
- [ ] **2.2 — Domain extraction** — Spot-check 5 records: WEBSITE field correctly stripped to domain_clean (no http://, no www., no trailing paths)
- [ ] **2.3 — MX check works** — `domains_mx_checked` > 0 in enrichment log. Some `domains_no_mx` expected.
- [ ] **2.4 — MX results cached** — Run enrichment twice on the same day (after budget reset). Second run should show fewer MX checks (cached in KV `enrichment:mx:{domain}`)
- [ ] **2.5 — Catch-all detection** — `domains_catch_all` count in log. Verify KV key `enrichment:catchall:{domain}` exists for at least one catch-all domain
- [ ] **2.6 — Pattern learning** — After first run, check KV for `enrichment:pattern:{domain}` keys. Second run should show `patterns_reused` > 0
- [ ] **2.7 — Reoon power mode** — Debug log (`vlp-scale/enrichment-logs/reoon-debug-{date}.json`) shows `verification_mode: "power"` in responses
- [ ] **2.8 — Valid emails found** — `emails_found_valid` > 0 in enrichment log (if zero after power mode fix, investigate Reoon responses)
- [ ] **2.9 — Budget tracking** — `reoon_credits_used` in log matches actual Reoon dashboard consumption. Counter stops at 450.
- [ ] **2.10 — 403 handling** — If Reoon returns 403 (out of credits), `stopped_reason` is `reoon_api_error`, budget counter is NOT incremented
- [ ] **2.11 — Master file write-back** — After enrichment, re-download master file. Enriched records have email_found and email_status populated. Unenriched records are unchanged.
- [ ] **2.12 — Balance check logged** — `reoon_balance_at_start` appears in enrichment log with daily/instant credit counts

### Pass criteria
At least 1 valid email found per run. Budget tracking matches Reoon dashboard within +/- 5 credits.

---

## 3. Campaign Router (12:00 UTC cron)

**Function:** `handleDailyBatchGeneration(env)`
**Trigger:** `0 12 * * *` cron or `POST /internal/test-daily-batch`

### Tests

- [ ] **3.1 — Eligible record filter** — Only records with email_found + valid email_status + all three *_email_1_prepared_at empty are selected
- [ ] **3.2 — Allocation percentages** — Over a batch of 200: ~130 TTMP (65%), ~50 VLP (25%), ~20 WLVLP (10%). Exact numbers will vary due to random assignment — acceptable range: TTMP 55-75%, VLP 15-35%, WLVLP 3-17%
- [ ] **3.3 — Daily cap enforced** — Batch log shows `batch_size` <= 200 even if more eligible records exist
- [ ] **3.4 — Queue append (not overwrite)** — If TTMP queue has 50 existing pending records and router adds 130, queue now has 180. No records lost.
- [ ] **3.5 — 6-email schedule** — Each queue record has email_{2..6}_scheduled_for dates at Day +2, +4, +6, +8, +10 from creation
- [ ] **3.6 — Personalization resolved** — Spot-check 3 records per campaign: First, City, credential_label, billing range, time savings, revenue opportunity all populated (no {placeholder} tokens remaining)
- [ ] **3.7 — Master file stamped** — Routed records have the correct *_email_1_prepared_at timestamp. Record cannot be re-routed on next run.
- [ ] **3.8 — Batch log written** — `vlp-scale/batch-logs/{date}.json` contains routed_ttmp, routed_vlp, routed_wlvlp, eligible_records, records_remaining_eligible
- [ ] **3.9 — No double-routing** — A record routed to TTMP does NOT also appear in VLP or WLVLP queues
- [ ] **3.10 — Empty eligible set** — If zero eligible records, batch log shows `batch_size: 0`, no queues modified, no errors

### Pass criteria
All three queues receive records in roughly correct proportions. No placeholder tokens in email bodies. No duplicate records across queues.

---

## 4. TTMP Send Handler (14:00 UTC cron)

**Function:** `handleTtmpEmailSend(env)` via `runStagedSendQueue`
**Queue:** `vlp-scale/ttmp-send-queue/email1-pending.json`
**Archive:** `vlp-scale/ttmp-send-queue/sent-{date}.json`

### Tests

- [ ] **4.1 — Email 1 sends** — Records with status "pending" get Email 1 sent. Status updates to "email_1_sent" with timestamp.
- [ ] **4.2 — Email 2 fires on schedule** — Records where email_2_scheduled_for <= today and status is "email_1_sent" get Email 2. Status updates to "email_2_sent".
- [ ] **4.3 — Emails 3-6 fire on schedule** — Same pattern for each stage. Verify at least one record progresses through all 6.
- [ ] **4.4 — Correct subjects** — Spot-check: Email 1 subject contains "translating IRS codes", Email 4 contains "I built this", Email 6 contains "Last note"
- [ ] **4.5 — Correct signature** — Every email body ends with "Jamie L Williams, EA" and "transcript.taxmonitor.pro"
- [ ] **4.6 — Hello {First} greeting** — Every email body starts with "Hello {First}," (actual name, not literal placeholder)
- [ ] **4.7 — Second {First} in body** — Each email contains the recipient's first name a second time in the body text
- [ ] **4.8 — Archive on completion** — Records with all 6 emails sent move to sent-{date}.json. No longer in pending queue.
- [ ] **4.9 — Failed records preserved** — If Gmail returns error, record stays in queue with last_error field. Not lost, not archived.
- [ ] **4.10 — Gmail 429 retry** — If rate limited, handler pauses 60s and retries up to 3 times before marking failed

### Pass criteria
All pending Email 1s send. Follow-up emails fire on correct dates. No records lost.

---

## 5. VLP Send Handler (14:00 UTC cron)

**Function:** `handleVlpEmailSend(env)` via `runStagedSendQueue`
**Queue:** `vlp-scale/vlp-send-queue/email1-pending.json`
**Archive:** `vlp-scale/vlp-send-queue/sent-{date}.json`

### Tests

- [ ] **5.1 — Email 1 sends** — Same as TTMP 4.1
- [ ] **5.2 — Emails 2-6 fire on schedule** — Same staged pattern
- [ ] **5.3 — VLP-specific subjects** — Email 1 contains "taxpayers in {City}", Email 3 contains "referrals slow down", Email 6 contains "Last note"
- [ ] **5.4 — VLP-specific signature** — "Virtual Launch Pro" and "virtuallaunch.pro" (not transcript.taxmonitor.pro)
- [ ] **5.5 — TTMP cross-sell in Email 6** — Breakup email includes transcript.taxmonitor.pro/pricing link
- [ ] **5.6 — new_client_value personalized** — Correct range per profession (EA/CPA/ATTY)
- [ ] **5.7 — Asset page links** — URLs contain correct slug: virtuallaunch.pro/asset/{slug}

### Pass criteria
Same as TTMP. VLP-specific copy and links verified.

---

## 6. WLVLP Send Handler (14:00 UTC cron)

**Function:** `handleWlvlpEmailSend(env)` via `runStagedSendQueue`
**Queue:** `vlp-scale/wlvlp-send-queue/email1-pending.json`
**Archive:** `vlp-scale/wlvlp-send-queue/sent-{date}.json`

### Tests

- [ ] **6.1 — All 6 emails supported** — Handler processes emails 1 through 6 (extended from original 2)
- [ ] **6.2 — WLVLP-specific subjects** — Email 1 contains "I looked at your website", Email 5 contains "been meaning to fix"
- [ ] **6.3 — WLVLP-specific signature** — "Website Lotto by Virtual Launch Pro" and "websitelotto.virtuallaunch.pro"
- [ ] **6.4 — TTMP cross-sell in Email 6** — Breakup email includes transcript.taxmonitor.pro/pricing link
- [ ] **6.5 — Asset page links** — URLs contain websitelotto.virtuallaunch.pro/asset/{slug}
- [ ] **6.6 — Legacy WLVLP records** — The 32 pre-existing WLVLP queue records from before Phase 2 still send correctly

### Pass criteria
6-email sequence completes. WLVLP-specific copy verified. Legacy records handled.

---

## 7. Gmail Integration

### Tests

- [ ] **7.1 — Service account auth** — sendGmailMessage successfully authenticates (no "Failed to parse GOOGLE_PRIVATE_KEY JSON" error)
- [ ] **7.2 — Email delivery** — Send a test email to your own inbox. Verify it arrives, displays correctly, has correct From address.
- [ ] **7.3 — UTF-8 handling** — Email bodies with em-dashes, smart quotes, or special characters send without "Latin1 range" errors
- [ ] **7.4 — Rate limit handling** — 429 responses trigger 60s pause + retry (up to 3 retries). Verify via logs if rate limit is hit at scale.
- [ ] **7.5 — Non-429 errors** — 4xx/5xx errors (other than 429) do NOT retry. Record marked as failed with error message.
- [ ] **7.6 — Bounce monitoring** — After sending 50+ emails, check Gmail sent folder for bounce-back messages. Acceptable bounce rate: < 5%.

### Pass criteria
Emails arrive in real inboxes. No auth errors. Rate limiting handled gracefully.

---

## 8. R2 Data Integrity

### Tests

- [ ] **8.1 — Master file format** — NDJSON (one JSON object per line). No blank lines break parsing. All 88,497 records present after any write-back.
- [ ] **8.2 — Queue files valid JSON** — Each send queue file is a valid JSON array. No truncation.
- [ ] **8.3 — No cross-contamination** — TTMP records only in ttmp-send-queue, VLP in vlp-send-queue, WLVLP in wlvlp-send-queue. Zero overlap.
- [ ] **8.4 — Archive files accumulate** — sent-{date}.json files created daily. Old archives not overwritten.
- [ ] **8.5 — Enrichment logs accumulate** — One log per day in vlp-scale/enrichment-logs/. Old logs not overwritten.
- [ ] **8.6 — Batch logs accumulate** — One log per day in vlp-scale/batch-logs/.

### R2 key inventory

| Key pattern | Written by | Read by |
|---|---|---|
| vlp-scale/foia-leads/foia-master.json | Enrichment + Router | Enrichment + Router |
| vlp-scale/enrichment-logs/{date}.json | Enrichment | Monitoring |
| vlp-scale/batch-logs/{date}.json | Router | Monitoring |
| vlp-scale/ttmp-send-queue/email1-pending.json | Router | TTMP send handler |
| vlp-scale/ttmp-send-queue/sent-{date}.json | TTMP send handler | Monitoring |
| vlp-scale/vlp-send-queue/email1-pending.json | Router | VLP send handler |
| vlp-scale/vlp-send-queue/sent-{date}.json | VLP send handler | Monitoring |
| vlp-scale/wlvlp-send-queue/email1-pending.json | Router | WLVLP send handler |
| vlp-scale/wlvlp-send-queue/sent-{date}.json | WLVLP send handler | Monitoring |
| vlp-scale/wlvlp-asset-pages/{slug}.json | Router | WLVLP site serving |

### Pass criteria
All files parseable. Record counts consistent across reads/writes. No data loss.

---

## 9. KV State Integrity

### Tests

- [ ] **9.1 — MX cache populated** — After enrichment run, `enrichment:mx:{domain}` keys exist for checked domains
- [ ] **9.2 — Catch-all cache populated** — `enrichment:catchall:{domain}` keys exist for tested domains
- [ ] **9.3 — Pattern cache populated** — `enrichment:pattern:{domain}` keys exist for domains where a pattern was found
- [ ] **9.4 — Budget counter accurate** — `enrichment:reoon_budget:{date}` matches expected Reoon call count
- [ ] **9.5 — TTLs working** — Keys expire after 30 days (MX, catch-all, pattern) or 48 hours (budget). Verify with `wrangler kv key get`

### Pass criteria
KV keys exist where expected. Budget counter matches Reoon dashboard.

---

## 10. End-to-End Smoke Test

Run this sequence to validate the entire pipeline from raw lead to sent email:

1. **Manually add a test record** to the master file with your own email address, a known good domain, and profession "EA"
2. **Trigger enrichment** — verify your test record gets email_found populated
3. **Trigger campaign router** — verify your test record appears in one of the three send queues
4. **Trigger the appropriate send handler** — verify you receive the email in your inbox
5. **Wait for Day 2** (or manually adjust the scheduled date) — verify Email 2 arrives
6. **Verify the email content**: correct greeting, correct personalization, correct links, correct signature

### Test record template

Add this line to the master NDJSON file:

```json
{"LAST_NAME":"TESTUSER","First_NAME":"Jamie","FULL_NAME":"Jamie TESTUSER","DBA":"Test Tax Firm","BUS_ADDR_CITY":"San Diego","BUS_ST_CODE":"CA","WEBSITE":"virtuallaunch.pro","BUS_PHNE_NBR":"","PROFESSION":"EA","domain_clean":"","email_found":"","email_status":"","firm_bucket":"","clay_workbook_ref":""}
```

After testing, remove this record from the master file and any send queues.

### Pass criteria
Email arrives in your inbox with correct personalization. Full 6-email sequence fires on schedule.

---

## 11. Monitoring Checklist (daily)

Run every morning after all three crons have fired (after 15:00 UTC):

- [ ] **Enrichment log** — Check `vlp-scale/enrichment-logs/{date}.json`. Verify emails_found_valid > 0 and stopped_reason is "budget_exhausted" or "completed" (not "reoon_api_error").
- [ ] **Batch log** — Check `vlp-scale/batch-logs/{date}.json`. Verify batch_size > 0 and allocation is roughly 65/25/10.
- [ ] **Send queues** — Check each pending queue. Verify queue sizes are growing (new records added) and shrinking (records progressing through stages and archiving).
- [ ] **Sent archives** — Check sent-{date}.json for each campaign. Records completing all 6 emails appear here.
- [ ] **Reoon balance** — Check via API. Credits should reset daily. If balance is 0 before 10:00 UTC, investigate.
- [ ] **Gmail bounce rate** — Check Gmail sent folder for bounce-backs. If > 5% of recent sends bounced, pause and investigate domain patterns.
- [ ] **Stripe dashboard** — Check for new TTMP token purchases, VLP memberships, or WLVLP template sales.

---

## 12. Known Limitations

**Worker timeout at scale:** The 14:00 UTC send block runs TTMP, VLP, and WLVLP sequentially. At full pipeline capacity (~200 new leads/day + follow-ups from prior 10 days), total daily sends could reach 600-900 emails. Without artificial delays this should complete quickly, but if Gmail 429 retries stack up (60s pause each), the Worker may timeout. Monitor duration_ms in send handler responses. If consistently > 10 minutes, split into separate cron slots.

**Reoon throughput:** 500 credits/day with power mode. Catch-all detection + pattern validation means each lead may consume 1-7 credits. Realistic enrichment rate: 75-200 new leads/day depending on domain diversity. 88K backlog will take months to fully enrich. Prioritization by domain clustering maximizes throughput.

**Pattern-unvalidated emails:** The first 50 TTMP emails were sent using pattern-generated addresses without Reoon validation. Higher bounce rate expected. Monitor these specifically.

**No open/click tracking:** The current pipeline sends plain text via Gmail API. No pixel tracking, no link wrapping. Open and click rates are not measurable until a tracking layer is added (future enhancement).

**No unsubscribe mechanism:** CAN-SPAM requires a working unsubscribe link in commercial email. The current emails do not include one. Add before scaling past initial test batches. This is a legal requirement.

**Single Gmail inbox:** All three campaigns send from the same address. If one campaign generates complaints, it affects deliverability for all three. Consider separating sending addresses per campaign when budget allows.

---

## Version History

| Date | Change |
|---|---|
| 2026-04-08 | Initial version — enrichment pipeline, campaign router, 3-campaign send system |