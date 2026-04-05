# VLP SCALE Workflow

Repo: C:\Users\eimaj\virtuallaunch.pro\scale\WORKFLOW.md
Owner: Jamie L Williams
Last updated: 2026-04-05

---

## Objective

Run the VLP SCALE cold email campaign. Source tax professional prospects via Clay, generate personalized outreach via the batch generator, send via Hunter.io, monitor results, and convert to VLP membership sales ($79-$399/mo) and TTMP token pack cross-sells ($19-$129).

This workflow removes the friction between "I have prospects" and "they received a personalized email with a working asset page."

---

## Materials Needed

| Material | Type | URL / Location |
|----------|------|---------------|
| BigQuery Console | Data source | https://console.cloud.google.com/bigquery?project=tax-monitor-pro |
| FOIA Google Sheet | Working sheet (66K+ rows) | https://docs.google.com/spreadsheets/d/1r9lkdOKj3Dcfh_tppN2NfORH0jTQBLYCXuElYnn2m7w/edit?gid=2106429687#gid=2106429687 |
| Apps Script project | Lead Tools script | https://script.google.com/u/0/home/projects/1Oc-EbXQS5UX-ktfizA8zCJjuJQoEtgq75pJjMdXpulChICesuf_406fr/edit?pli=1 |
| Clay | Prospect enrichment | https://app.clay.com |
| Hunter.io | Email sending | https://hunter.io/dashboard |
| Stripe | Payment dashboard | https://dashboard.stripe.com |
| Cloudflare | Hosting dashboard | https://dash.cloudflare.com |
| Cal.com | Booking dashboard | https://app.cal.com |
| Gmail (Workspace) | Email account | https://mail.google.com |
| VLP site | Live product | https://virtuallaunch.pro |
| VLP pricing | Conversion page | https://virtuallaunch.pro/pricing |
| TMP directory | Value prop page | https://taxmonitor.pro/directory |
| TTMP pricing | Cross-sell page | https://transcript.taxmonitor.pro/pricing |
| Batch generator | Local script | `C:\Users\eimaj\virtuallaunch.pro\scale\generate-vlp-batch.js` |
| R2 push script | Local script | `C:\Users\eimaj\virtuallaunch.pro\scale\push-vlp-asset-pages.js` |
| Prospect CSV folder | Local folder | `C:\Users\eimaj\virtuallaunch.pro\scale\prospects\` |

---

## Required Output Schema

The Google Sheet uses this exact column order. The batch generator expects these columns.

```text
LAST_NAME
First_NAME
FULL_NAME
DBA
BUS_ADDR_CITY
BUS_ST_CODE
WEBSITE
BUS_PHNE_NBR
PROFESSION
domain_clean
email_found
email_status
firm_bucket
clay_workbook_ref
```

Notes:
- `FULL_NAME` is required by Clay for Work Email enrichment. The batch generator ignores it.
- `clay_workbook_ref` is for recordkeeping and dedup across batches.
- Tracking columns (`vlp_email_1_prepared_at`, `vlp_email_2_prepared_at`) are added by the batch generator. Never add these manually.

---

## Table of Contents

- [Phase 0 — Source Data from BigQuery](#phase-0--source-data-from-bigquery-one-time-setup)
- [Phase 1 — Source Prospects via Clay](#phase-1--source-prospects-via-clay)
  - [Task 1.1 — Select next 50 rows](#task-11--select-next-50-rows-from-foia-sheet)
  - [Task 1.2 — Export batch to CSV](#task-12--export-batch-to-csv)
  - [Task 1.3 — Enrich VLP batch in Clay](#task-13--enrich-vlp-batch-in-clay)
  - [Task 1.4 — Return VLP emails and export](#task-14--return-vlp-emails-to-google-sheet-and-export)
  - [Task 1.5 — Select next 50 for TTMP](#task-15--select-next-50-rows-for-ttmp-batch)
  - [Task 1.6 — Export TTMP batch to CSV](#task-16--export-ttmp-batch-to-csv)
  - [Task 1.7 — Enrich TTMP batch in Clay](#task-17--enrich-ttmp-batch-in-clay)
  - [Task 1.8 — Return TTMP emails and export](#task-18--return-ttmp-emails-to-google-sheet-and-export)
- [Phase 2 — Generate Batch](#phase-2--generate-batch)
- [Phase 3 — Push Asset Pages to R2](#phase-3--push-asset-pages-to-r2)
- [Phase 4 — Import to Hunter.io and Send](#phase-4--import-to-hunterio-and-send)
- [Phase 5 — Daily Monitoring](#phase-5--daily-monitoring)
- [Phase 6 — Weekly Review](#phase-6--weekly-review)
- [Batch Cadence](#batch-cadence)
- [File Reference](#file-reference)

---

## Phase 0 — Source Data from BigQuery (one-time setup)

### Objective
Extract the IRS FOIA raw dataset into a working Google Sheet. This only runs once per BigQuery export. If the active Google Sheet still has unprocessed rows, skip to Phase 1.

### Task 0.1 — Open BigQuery

**Purpose:** Access the shaped FOIA dataset for prospect extraction.

**Action:** Open the BigQuery console and run the shaped query.

**Inputs required:**
- Access: Google Cloud (logged in to tax-monitor-pro project)
- File: `bigquery-shaped-query-v2.sql`

**Steps:**
1. Open BigQuery: [BigQuery Console — IRS FOIA Raw](https://console.cloud.google.com/bigquery?project=tax-monitor-pro&ws=!1m16!1m4!4m3!1svirtual-launch-pro!2sfoiaextract_1775094209207!3sirs_foia_raw_2026_0401!1m10!12m5!1m3!1stax-monitor-pro!2snorthamerica-northeast1!3s31a4d9ff-f91b-46a3-aa06-b0ab2274de2c!2e1!14m3!1stax-monitor-pro!2sbquxjob_102eaf3e_19d55d169c4!3sUS)
2. Run the shaped query (`bigquery-shaped-query-v2.sql`) — NOT the raw FOIA query
3. The shaped query pre-filters to: US-based records, recognized professions (EA, CPA, ATTY), records with a website, excludes known national firms
4. This reduces 858K+ raw rows to an exportable size
5. Click **Save results → Google Sheets**
6. Open the generated Google Sheet

**Validation:**
- [ ] Query completed without errors
- [ ] Google Sheet created with header row matching Required Output Schema
- [ ] Row count is in the tens of thousands (expected ~66K+)

**Next:** Task 0.2

---

### Task 0.2 — Set up the Google Sheet (one-time)

**Purpose:** Install the Lead Tools Apps Script and run initial data processing.

**Action:** Add the Apps Script, deploy it, run the three initial processing steps.

**Inputs required:**
- Access: Google Sheets (the sheet from Task 0.1)
- File: `lead-tools-apps-script.js`
- Apps Script project: https://script.google.com/u/0/home/projects/1Oc-EbXQS5UX-ktfizA8zCJjuJQoEtgq75pJjMdXpulChICesuf_406fr/edit?pli=1

**Steps:**
1. In Google Sheets: **Extensions → Apps Script**
2. Paste the Lead Tools script from the Apps Script project above
3. Save, then **Deploy → New deployment → Web app → Deploy**
4. Return to sheet and refresh the page
5. Verify the **Lead Tools** menu appears with three submenus:
   - **Prepare** — Clean domains, Normalize phone numbers, Mark email_status, Validate email-domain match
   - **Classify** — Classify firm buckets
   - **Clay Batch** — Select next 50 rows, Clear Clay batch markers
6. Run in order:
   - **Lead Tools → Prepare → Clean domains**
   - **Lead Tools → Prepare → Normalize phone numbers**
   - **Lead Tools → Classify → Classify firm buckets**

**Validation:**
- [ ] Lead Tools menu visible with all 3 submenus
- [ ] `domain_clean` column populated
- [ ] Phone numbers normalized to (XXX) XXX-XXXX
- [ ] `firm_bucket` column populated (solo_brand / local_firm / national_firm)

**Next:** Phase 1 (repeatable pipeline)

---

## Phase 1 — Source Prospects via Clay

### Objective
Produce a clean CSV of 30-50 tax professional prospects with verified email addresses, ready for the batch generator. This phase removes the risk of sending to invalid emails or contacting prospects already in the TTMP pipeline.

### Task 1.1 — Select next 50 rows from FOIA sheet

**Purpose:** Identify the next batch of unprocessed prospects from the master FOIA dataset.

**Action:** Open the FOIA Google Sheet, use Lead Tools to select the next 50 eligible rows.

**Inputs required:**
- Access: Google Sheets (logged in)
- Preconditions: FOIA sheet has unprocessed rows with `clay_workbook_ref` empty

**Steps:**
1. Open the FOIA Google Sheet (see Materials Needed)
2. Filter `firm_bucket` to show only `solo_brand` and `local_firm`
3. Run **Lead Tools → Clay Batch → Select next 50 rows**
4. 50 rows highlight yellow

**Validation:**
- [ ] 50 rows highlighted
- [ ] All highlighted rows have `domain_clean` populated
- [ ] No highlighted rows have `clay_workbook_ref` already filled

**Outputs:** 50 highlighted rows ready for export.

**Failure mode if skipped:** You export the wrong rows or re-process already-enriched prospects.

**Next:** Task 1.2

---

### Task 1.2 — Export batch to CSV

**Purpose:** Create the input file for Clay enrichment.

**Action:** Select only the 50 highlighted rows and download as CSV.

**Steps:**
1. Select the 50 highlighted rows (not the full sheet)
2. Copy to a new sheet tab or download selection as CSV
3. Save as CSV to Downloads folder

**Validation:**
- [ ] CSV has exactly 50 rows (plus header)
- [ ] CSV contains columns: LAST_NAME, First_NAME, FULL_NAME, DBA, BUS_ADDR_CITY, BUS_ST_CODE, domain_clean

**Outputs:** CSV file in Downloads folder.

**Next:** Task 1.3

---

### Task 1.3 — Enrich VLP batch in Clay

**Purpose:** Find verified work email addresses for VLP campaign prospects.

**Action:** Create a Clay workbook for VLP, import the CSV, run Work Email enrichment.

**Inputs required:**
- Access: Clay.com (logged in)
- File: CSV from Task 1.2

**Steps:**
1. Go to https://app.clay.com → **+ New workbook**
2. Name: `VLP FOIA YYYY_MMDD_###` (### = running total of VLP prospects)
3. Upload the CSV
4. Run **Tools → Enrichment → Work Email** with mapping:
   - Full Name → `FULL_NAME`
   - Company Domain → `domain_clean`
5. Wait for enrichment to complete
6. Delete the CSV from Downloads folder (Clay has its copy)

**Validation:**
- [ ] Work Email column populated for 30+ rows
- [ ] Workbook name starts with `VLP FOIA`

**Outputs:** Clay workbook with enriched VLP prospect emails.

**Next:** Task 1.4

---

### Task 1.4 — Return VLP emails to Google Sheet and export

**Purpose:** Merge Clay's VLP email results back into the sheet, validate, and export for the VLP batch generator.

**Steps:**
1. Return to Google Sheet — verify unfiltered, original row order
2. Match each email to its row using `FULL_NAME` + `domain_clean` as join key
3. Paste emails into `email_found` column for VLP batch rows
4. Paste Clay workbook ID into `clay_workbook_ref` for all 50 rows
5. Run **Lead Tools → Prepare → Mark email_status**
6. Run **Lead Tools → Prepare → Validate email ↔ domain match**
7. Review red rows (domain mismatch) — fix or remove
8. Review orange rows (personal email) — decide keep or remove
9. Filter to: `clay_workbook_ref` = this VLP workbook + `email_status` = valid + no red highlights
10. Check: does `C:\Users\eimaj\virtuallaunch.pro\scale\prospects\new-prospects.csv` already exist with data rows?
    - If YES: previous batch not processed. Run VLP batch generator first (Phase 2), then come back.
    - If NO: proceed.
11. Download filtered rows as CSV
12. Save to `C:\Users\eimaj\virtuallaunch.pro\scale\prospects\new-prospects.csv`
13. Delete CSV from Downloads folder immediately

**Validation:**
- [ ] CSV saved at VLP prospects path with 30+ valid rows
- [ ] No "undefined" or empty email values
- [ ] No CSV remains in Downloads folder
- [ ] `clay_workbook_ref` filled for all 50 rows with VLP workbook ID

**Outputs:** `virtuallaunch.pro/scale/prospects/new-prospects.csv` — ready for VLP batch generator.

**Failure mode if skipped:** Bad emails → high bounce rate → sender reputation destroyed.

**Next:** Task 1.5

---

### Task 1.5 — Select next 50 rows for TTMP batch

**Purpose:** Start a separate Clay enrichment cycle for TTMP campaign prospects. These are different prospects from the VLP batch.

**Action:** Select the next 50 eligible rows from the FOIA sheet for TTMP.

**Steps:**
1. Confirm the 50 VLP rows from Task 1.1 are no longer eligible (they have `clay_workbook_ref` filled)
2. Run **Lead Tools → Clay Batch → Select next 50 rows**
3. 50 NEW rows highlight yellow — these are different prospects from the VLP batch

**Validation:**
- [ ] 50 new rows highlighted (not the same rows as VLP)
- [ ] All highlighted rows have `domain_clean` populated
- [ ] No highlighted rows have `clay_workbook_ref` already filled

**Next:** Task 1.6

---

### Task 1.6 — Export TTMP batch to CSV

**Purpose:** Create the input file for TTMP Clay enrichment.

**Steps:**
1. Select only the 50 highlighted rows
2. Download as CSV
3. Save to Downloads folder

**Validation:**
- [ ] CSV has exactly 50 rows plus header
- [ ] These are DIFFERENT prospects from the VLP batch

**Next:** Task 1.7

---

### Task 1.7 — Enrich TTMP batch in Clay

**Purpose:** Find verified work email addresses for TTMP campaign prospects in a separate Clay workbook.

**Steps:**
1. Go to https://app.clay.com → **+ New workbook**
2. Name: `TTMP FOIA YYYY_MMDD_###` (### = running total of TTMP prospects)
3. Upload the CSV from Task 1.6
4. Run **Tools → Enrichment → Work Email** with same mapping:
   - Full Name → `FULL_NAME`
   - Company Domain → `domain_clean`
5. Wait for enrichment to complete
6. Delete the CSV from Downloads folder

**Validation:**
- [ ] Work Email column populated for 30+ rows
- [ ] Workbook name starts with `TTMP FOIA`

**Outputs:** Clay workbook with enriched TTMP prospect emails.

**Next:** Task 1.8

---

### Task 1.8 — Return TTMP emails to Google Sheet and export

**Purpose:** Merge Clay's TTMP email results back, validate, and export for the TTMP merge script.

**Steps:**
1. Return to Google Sheet — verify unfiltered, original row order
2. Match each email to its row using `FULL_NAME` + `domain_clean` as join key
3. Paste emails into `email_found` column for TTMP batch rows
4. Paste TTMP Clay workbook ID into `clay_workbook_ref` for all 50 rows
5. Run **Lead Tools → Prepare → Mark email_status**
6. Run **Lead Tools → Prepare → Validate email ↔ domain match**
7. Review red rows — fix or remove
8. Review orange rows — decide keep or remove
9. Filter to: `clay_workbook_ref` = this TTMP workbook + `email_status` = valid + no red highlights
10. Check: does `C:\Users\eimaj\transcript.taxmonitor.pro\scale\prospects\new-prospects.csv` already exist with data rows?
    - If YES: previous batch not processed. Run TTMP merge script first, then come back.
    - If NO: proceed.
11. Download filtered rows as CSV
12. Save to `C:\Users\eimaj\transcript.taxmonitor.pro\scale\prospects\new-prospects.csv`
13. Delete CSV from Downloads folder immediately

**Validation:**
- [ ] CSV saved at TTMP prospects path with 30+ valid rows
- [ ] No "undefined" or empty email values
- [ ] No CSV remains in Downloads folder
- [ ] No prospect in this CSV also appears in the VLP CSV from Task 1.4
- [ ] `clay_workbook_ref` filled for all 50 rows with TTMP workbook ID

**Outputs:** `transcript.taxmonitor.pro/scale/prospects/new-prospects.csv` — ready for TTMP merge script.

**Failure mode if skipped:** Same prospect gets VLP and TTMP emails = two cold emails to the same person from the same sender.

**Next:** Phase 2 (VLP batch generation)

---

## Phase 2 — Generate Batch

### Objective
Transform the prospect CSV into personalized email copy and asset page data. This phase removes the manual work of writing individual emails.

### Task 2.1 — Run the batch generator

**Purpose:** Produce Hunter.io-ready CSV and R2-ready asset page JSON from the prospect list.

**Action:** Run the generator script.

**Inputs required:**
- File: `scale/prospects/new-prospects.csv` (from Phase 1)
- Preconditions: CSV has required columns, no empty emails

**Steps:**
```bash
cd C:\Users\eimaj\virtuallaunch.pro
node scale/generate-vlp-batch.js scale/prospects/new-prospects.csv
```

**Validation:**
- [ ] Script reports "Prospects processed: N" (N > 0)
- [ ] `scale/hunter/vlp-email1-{date}.csv` exists
- [ ] `scale/batches/vlp-batch-{date}.json` exists
- [ ] Spot-check 3 rows in Hunter CSV: no "undefined", signature present, links correct
- [ ] Source CSV has `vlp_email_1_prepared_at` timestamps

**Outputs:**
- Hunter CSV for email sending
- Batch JSON for asset pages
- Updated source CSV with tracking timestamps

**Failure mode if skipped:** No emails to send.

**Next:** Phase 3

---

## Phase 3 — Push Asset Pages to R2

### Objective
Make personalized asset pages live at `virtuallaunch.pro/asset/{slug}` so prospects can see their practice analysis when they click the email link.

### Task 3.1 — Push to R2

**Purpose:** Upload asset page data so the VLP Worker can serve them.

**Steps:**
```bash
node scale/push-vlp-asset-pages.js scale/batches/vlp-batch-{date}.json --exec
```

**Validation:**
- [ ] Script reports N pages pushed
- [ ] Open one asset page in browser: `https://virtuallaunch.pro/asset/{slug}`
- [ ] Page shows prospect name, city, credential
- [ ] Tier comparison shows $79/$199/$399
- [ ] TTMP cross-sell link works

**Failure mode if skipped:** Prospects click email link → 404 page → lost forever.

**Next:** Phase 4

---

## Phase 4 — Import to Hunter.io and Send

### Objective
Get the personalized emails into Hunter.io and start the campaign sending.

### Task 4.1 — Import CSV to Hunter

**Purpose:** Upload the generated email data to Hunter's sending platform.

**Inputs required:**
- Access: Hunter.io (logged in)
- File: `scale/hunter/vlp-email1-{date}.csv`

**Steps:**
1. Open https://hunter.io/dashboard
2. Go to Campaigns → your active campaign (or create new: "VLP SCALE — Batch {date}")
3. Click Recipients → Import from CSV
4. Upload `scale/hunter/vlp-email1-{date}.csv`
5. Map columns:
   - `email` → Email
   - `first_name` → First name
   - `last_name` → Last name
   - `company` → Company
   - `subject` → Subject
   - `body` → Email body
6. Click Import

**Validation:**
- [ ] Hunter shows correct recipient count
- [ ] Preview 2-3 emails — subject personalized, body correct, links present

**Next:** Task 4.2

---

### Task 4.2 — Send test email

**Purpose:** Verify the email looks right in a real inbox before sending to prospects.

**Steps:**
1. Add your own email address as a test recipient
2. Send just that one email
3. Check your inbox

**Validation:**
- [ ] Email arrived in inbox (not spam)
- [ ] Subject line personalized
- [ ] Asset page link clickable and works
- [ ] Pricing link works
- [ ] TTMP cross-sell link works
- [ ] Signature shows Jamie L Williams

**Failure mode if skipped:** Broken links or formatting go to real prospects. No undo.

**Next:** Task 4.3

---

### Task 4.3 — Launch campaign

**Purpose:** Start sending to real prospects.

**Steps:**
1. Remove your test email from recipients
2. Verify sending settings: 15/day (week 1), Mon-Fri, 9am-5pm
3. Click Start Campaign

**Validation:**
- [ ] Campaign status shows "Active" or "Sending"
- [ ] Daily limit set correctly per warmup schedule

**Warmup schedule:**

| Week | Daily limit | Notes |
|------|------------|-------|
| 1 | 15 | Watch for bounces > 5% |
| 2 | 25 | Check open rates > 15% |
| 3 | 40 | Monitor spam complaints |
| 4+ | 50-100 | Only if bounce < 3%, no complaints |

**Next:** Phase 5 (start the day after first send)

---

## Phase 5 — Daily Monitoring

### Objective
Catch problems early and respond to engaged prospects. Takes 15 minutes each morning.

### Task 5.1 — Morning check

**Purpose:** Stay on top of campaign health and respond to interest.

**Steps:**
1. Open https://hunter.io/dashboard — check: sent, opened, replied, bounced
2. Open https://dashboard.stripe.com — check: new subscriptions, payments
3. Open https://mail.google.com — check: prospect replies

**Validation:**
- [ ] Bounce rate < 5% (if above: pause campaign, clean list)
- [ ] Any replies responded to within 24 hours
- [ ] Any Stripe activity logged

**Next:** Repeat daily. Phase 6 on Fridays.

---

## Phase 6 — Weekly Review

### Objective
Assess campaign performance and pipeline health. Adjust sending and sourcing.

### Task 6.1 — Friday review

**Steps:**
1. Log metrics: sent, opened, clicked, replied, converted
2. Check pipeline: how many eligible prospects remain in source CSV
3. If < 100 remaining: start new Clay cycle (back to Phase 1)
4. If open rate < 15%: test new subject lines next batch
5. If bounce rate > 3%: review email validation process
6. Adjust Hunter daily limit per warmup schedule

**Validation:**
- [ ] Metrics logged
- [ ] Pipeline health assessed
- [ ] Daily limit adjusted if needed

**Next:** Phase 1 (new batch) or continue monitoring.

---

## Batch Cadence

Each cycle through Phases 1-4 adds 30-50 prospects to the campaign.
Run one cycle per week during Month 1.
Scale to 2-3 cycles per week as results prove out.

Hunter free plan: 500 recipients per campaign. Create new campaign when limit reached.
Google Workspace: 2,000 emails/day — not the bottleneck.

---

## TTMP Batch Generation (quick reference)

After placing the TTMP CSV at `transcript.taxmonitor.pro/scale/prospects/new-prospects.csv`:

**Step 1 — Run merge script:**
```bash
cd C:\Users\eimaj\transcript.taxmonitor.pro
node scale/scripts/merge-intake.js
```

**Step 2 — Run batch generator:**
```bash
node scale/generate-batch.js scale/prospects/{master-csv-filename}.csv
```

**Step 3 — Upload to Hunter.io:**
Create a separate Hunter campaign: "TTMP SCALE — Batch {date}"
Import: `scale/gmail/email1/{date}-batch.csv`

For full TTMP-specific details, see the TTMP WORKFLOW.md stub at:
`C:\Users\eimaj\transcript.taxmonitor.pro\WORKFLOW.md`

---

## File Reference

| File | Purpose | Who writes it |
|------|---------|---------------|
| `scale/prospects/new-prospects.csv` | Intake from Clay export | You (Phase 1) |
| `scale/prospects/*.csv` | Source CSVs | You (placed here) |
| `scale/batches/vlp-batch-{date}.json` | Asset page data | Generator (Phase 2) |
| `scale/hunter/vlp-email1-{date}.csv` | Hunter.io import file | Generator (Phase 2) |
| `scale/push-vlp-asset-pages.js` | R2 push script | Repo Claude (one-time) |
| `scale/generate-vlp-batch.js` | Batch generator | Repo Claude (one-time) |
| `scale/SCHEDULE.md` | Master action plan | This is your entry point |
| `scale/WORKFLOW.md` | This file | Operational detail |