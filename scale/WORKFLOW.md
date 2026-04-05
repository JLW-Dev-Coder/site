# VLP SCALE Workflow

Repo: C:\Users\eimaj\virtuallaunch.pro\scale\WORKFLOW.md
Owner: Jamie L Williams
Last updated: 2026-04-05

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
- [Phase 5 — Monitor Results](#phase-5--monitor-results)
- [Worker Cron Reference](#worker-cron-reference)
- [Phase 6 — Daily Monitoring](#phase-6--daily-monitoring)
- [Phase 7 — Weekly Review](#phase-7--weekly-review)
- [Batch Cadence](#batch-cadence)
- [File Reference](#file-reference)

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
| Merge script | Local script | `C:\Users\eimaj\virtuallaunch.pro\scale\scripts\merge-intake.js` |
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

## Phase 0 — Source Data from BigQuery (one-time setup)

**Status:** COMPLETE (2026-04-01)

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

**Status:** COMPLETE (2026-04-05) — VLP batch: 33 prospects sourced. TTMP batch: 293 prospects sourced.

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

**Status:** COMPLETE (2026-04-05) — 33 VLP prospects processed. Batch: `vlp-batch-2026-04-05.json`. Hunter CSV: `vlp-email1-2026-04-05.csv`.

### Objective
Transform the prospect CSV into personalized email copy and asset page data. This phase removes the manual work of writing individual emails.

### Task 2.1 — Merge intake and generate batch

**Purpose:** Merge new prospects into the master CSV, then generate personalized emails and asset pages.

**Action:** Run merge script first, then batch generator.

**Steps:**

**Merge:**
1. Open Claude Code in the VLP repo
2. Run:
   ```
   node scale/scripts/merge-intake.js
   ```
3. Verify output: rows appended, duplicates skipped, master total

**Generate:**
4. Run:
   ```
   node scale/generate-vlp-batch.js
   ```
5. Verify output:
   - "Prospects processed: N"
   - `scale/hunter/vlp-email1-{date}.csv` exists
   - `scale/batches/vlp-batch-{date}.json` exists

**Validation:**
- [ ] Merge script ran without errors
- [ ] No duplicate emails in master CSV
- [ ] Batch generator processed N prospects (N > 0)
- [ ] Hunter CSV: spot-check 3 rows — no "undefined", signature present, links correct
- [ ] Master CSV has `vlp_email_1_prepared_at` timestamps on processed rows
- [ ] `new-prospects.csv` truncated to headers only (ready for next intake)
- [ ] Lockfile `.batch-in-progress` does not exist (generator cleaned up)

**Outputs:**
- Updated `scale/prospects/vlp-master.csv` with timestamps
- `scale/hunter/vlp-email1-{date}.csv` for Hunter.io
- `scale/batches/vlp-batch-{date}.json` for asset pages
- Archived intake at `scale/prospects/archive/intake-{timestamp}.csv`

**Failure mode if skipped:** Generator reads stale data, re-contacts already-emailed prospects.

**Next:** Phase 3 (push asset pages to R2)

---

## Phase 3 — Push Asset Pages to R2

**Status:** COMPLETE (2026-04-05) — 33 asset pages pushed to R2.

### Objective
Make personalized asset pages live at `virtuallaunch.pro/asset/{slug}` so prospects can see their practice analysis when they click the email link.

### Task 3.1 — Push to R2

**Purpose:** Upload asset page data so the VLP Worker can serve them.

**Steps:**
```bash
node scale/push-vlp-asset-pages.js scale/batches/vlp-batch-{date}.json --exec --remote
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

**Status:** COMPLETE (2026-04-05) — Sequence launched. 33 leads imported, verified, sending 15/day starting 2026-04-06.

### Objective

Import the Hunter CSV into a Hunter.io sequence, build the email template with merge fields, verify deliverability, and launch the campaign.

### Task 4.1 — Create the sequence

**Purpose:** Set up the Hunter.io sequence that will send the emails on a schedule.

**Steps:**
1. Open https://hunter.io/dashboard
2. Go to **Sequences** (left sidebar) → **+ New Sequence**
3. Name it: `IRS FOIA Batch {YYYY_MMDD_###}` (### = running prospect total)

**Next:** Task 4.2

---

### Task 4.2 — Import the Hunter CSV

**Purpose:** Upload prospect data with individual merge fields for personalized emails.

**Steps:**
1. Inside the sequence, click **Import leads** (or Audience → Import)
2. Upload: `scale/hunter/vlp-email1-{date}.csv`
3. Verify the upload shows: **10 columns, N rows** (should match your batch size, e.g., 33)
   - If rows are inflated (e.g., 462 instead of 33), the CSV has multiline fields — the body column must use `<br>` or the individual merge field approach must be used instead
4. Click **Next** → Map columns screen

**Column mapping:**

| CSV column | Hunter attribute | Type |
|-----------|-----------------|------|
| email | Email address | Built-in |
| first_name | First name | Built-in |
| last_name | Last name | Built-in |
| company | Company | Built-in |
| subject | subject | Custom — create via "Create a new attribute" |
| city | City | Built-in |
| credential_label | credential_label | Custom — create |
| firm_display | firm_display | Custom — create |
| asset_url | asset_url | Custom — create |
| slug | slug | Custom — create (optional, for reference only) |

5. Confirm: **10 of 10 columns mapped**
6. Click **Next** → Configure screen

**Next:** Task 4.3

---

### Task 4.3 — Configure import settings

**Purpose:** Verify emails and organize leads into a trackable list.

**Steps:**
1. **Enrichment:**
   - Business details: leave ON (free)
   - Find missing emails: leave unchecked (every row has an email)
   - Verify existing emails: **CHECK this** — uses ~0.5 credits per email, worth it to catch bad addresses before sending
2. **Options:**
   - Check "Add leads to a specific list"
   - Create a new list: `IRS FOIA Batch {YYYY_MMDD_###}`
   - Add to folder: `IRS FOIA Batches` (create on first batch)
3. Click **Start import**
4. Wait for verification to complete
5. Review results:
   - Valid: should be 85%+ (good)
   - Accept all: acceptable, usually fine
   - Invalid: remove these leads before sending

**Credit usage:** ~17 credits per 33 leads. Free plan gives 50 credits/month.

**Validation:**
- [ ] Import shows N leads imported
- [ ] Verification complete — no invalid emails (or invalids removed)
- [ ] Leads visible in the list under IRS FOIA Batches folder

**Next:** Task 4.4

---

### Task 4.4 — Build the email template

**Purpose:** Create a personalized email using Hunter's merge fields. Do NOT put the entire email body in a single CSV column — Hunter's plain text editor renders `<br>` tags literally.

**Critical: use individual merge fields, not a single body column.**

**Steps:**
1. Go to the sequence → **Content** tab
2. Make sure **A/B test this email** is OFF
3. **Subject line:** Click the send icon or "Insert attribute" → select `subject` → Fallback: `Your practice could be reaching more clients`
4. **Body:** Type the template below directly into Hunter's editor. For each merge field, click "Insert attribute", select the field, and set the fallback value.

**Template to type into Hunter:**

```
Hello {{first_name}},

Taxpayers in {{city}} search online for tax help every day. Most never find you because you're not in the places they're looking.

The Tax Monitor Pro network puts your profile in front of taxpayers who need exactly what you offer — {{credential_label}} with experience in general tax preparation. Listings start at $79/mo and include transcript automation tokens so your practice gets more efficient at the same time.

Here's a quick practice analysis I put together for {{firm_display}}:
{{asset_url}}

And if you just want to try the transcript tool first, no membership needed:
https://transcript.taxmonitor.pro/pricing
10 analyses for $19 — takes 30 seconds per transcript.

See all membership tiers here:
https://virtuallaunch.pro/pricing

—
Jamie L Williams
Virtual Launch Pro
virtuallaunch.pro
```

**Fallback values for each merge field:**

| Attribute | Fallback |
|-----------|----------|
| first_name | there |
| city | your area |
| credential_label | tax professionals |
| firm_display | your practice |
| asset_url | https://virtuallaunch.pro/pricing |
| subject | Your practice could be reaching more clients |

5. Click **Preview** tab — click through 3-4 leads to confirm personalization works:
   - [ ] Names are correct (not fallback values)
   - [ ] Cities are correct
   - [ ] Credential labels match (CPAs, Enrolled Agents, etc.)
   - [ ] Asset URLs have correct slugs
   - [ ] Line breaks render properly (no `<br>` tags visible)

**Spam score note:** Hunter's spam checker may flag the template as "Spammy" because it sees the merge field placeholder syntax (e.g., `{{first_name:"there"}}`) as filler text. This is a false positive — the rendered email with real prospect data is clean. Ignore this warning if the Preview tab shows professional, personalized content.

**Next:** Task 4.5

---

### Task 4.5 — Send test email

**Purpose:** Verify the email arrives with proper formatting before sending to real prospects.

**Steps:**
1. Go to **Content** tab
2. Click the send/paper plane icon next to the subject line
3. Enter a personal email address (not your sending address) — e.g., a Gmail or AOL address
4. Click **Send test email**
5. Check inbox (and spam folder) for the test

**What to verify:**
- [ ] Email arrived (check spam if not in inbox)
- [ ] Line breaks render correctly (no `<br>` tags)
- [ ] Links are clickable
- [ ] Sender shows as Jamie Williams / jamie.williams@virtuallaunch.pro
- [ ] Unsubscribe link present at bottom
- [ ] No broken merge fields visible

**Note:** Test emails use fallback values, not personalized data. AOL and Gmail may flag test emails as spam — this is normal for cold email from a new sender. Business domain recipients (CPA firms) have less aggressive spam filtering.

**Next:** Task 4.6

---

### Task 4.6 — Configure sending settings

**Purpose:** Set timezone, tracking, and sending schedule.

**Steps:**
1. Go to **Settings** tab
2. If timezone warning appears: click "set your time zone" → select **(GMT-08:00) Pacific Time (US & Canada)**
3. **Tracking:**
   - Track email opens: ON
   - Track link clicks: OFF (paid feature — enable when upgraded)
4. **Sending window:**
   - Days: Monday through Friday (Saturday and Sunday unchecked)
   - Hours: 9:00 AM to 5:00 PM
5. **Sending limit:** Leave at 15/day for week 1 warmup
   - Week 2: increase to 25/day
   - Week 3: increase to 40/day
   - Week 4+: 50/day
6. **Unsubscribe:** Leave ON with default text
7. **BCC:** Leave OFF
8. Click **Save schedule** and **Save settings**

**Next:** Task 4.7

---

### Task 4.7 — Launch the sequence

**Purpose:** Start sending emails on the configured schedule.

**Steps:**
1. Click **Launch sequence** (orange button, top right)
2. Confirm the launch dialog shows:
   - Sent from: jamie.williams@virtuallaunch.pro
   - Sent to: N recipients
   - Up to 15 emails sent per day
   - Starts tomorrow at 09:00 am
3. Click **Launch sequence** to confirm

**Validation:**
- [ ] Sequence status shows "Active" or "Running"
- [ ] First batch scheduled for next business day at 9:00 AM Pacific

**Outputs:**
- Active Hunter.io sequence sending 15 emails/day
- All 33 prospects will receive email within 3 business days

**Failure mode if skipped:** No emails go out. Pipeline stalls.

**Next:** Phase 5 (Monitor results)

---

## Phase 5 — Monitor Results

**Status:** NOT STARTED — First emails send 2026-04-06. Begin monitoring 2026-04-07.

### Task 5.1 — Check open rates (Day 2)

**Purpose:** Verify emails are being delivered and opened.

**Steps:**
1. Open Hunter.io → Sequences → your active sequence
2. Check the dashboard for:
   - Emails sent
   - Open rate (target: 30%+ is good for cold email)
   - Bounces (should be 0 with verified emails)
   - Unsubscribes
3. If open rate is below 15%: review subject lines, check if emails are landing in spam
4. If bounces occur: remove those leads and investigate the email source

**Repeat:** Check daily for the first week, then weekly.

**Next:** Task 5.2

---

### Task 5.2 — Handle replies

**Purpose:** Respond to any prospects who reply to the email.

**Steps:**
1. Check jamie.williams@virtuallaunch.pro inbox for replies
2. Positive replies (interested, questions): respond within 2 hours, offer a discovery call via https://cal.com/vlp/ttmp-discovery
3. Negative replies (not interested): respond politely, thank them, remove from future batches
4. Out of office: note and follow up when they return

**Next:** Phase 6 (next batch cycle — return to Phase 1)

---

## Worker Cron Reference

### Email 1 — Ramp-up schedule

The VLP Worker cron at 14:00 UTC (7:00 AM Pacific) sends Email 1 with a daily cap based on days since `send_start_date`:

| Days since start | Daily cap |
|-----------------|-----------|
| 1–3 | 10 emails |
| 4–7 | 20 emails |
| 8–14 | 30 emails |
| 15+ | 50 emails |

The cap applies only to Email 1. The queue is sliced to the daily cap, each email has a randomized delay of 45–90 seconds between sends, and sent records are marked with timestamps in the R2 queue JSON.

### Email 2 — No cap

Email 2 sends to all eligible records where `email_2_scheduled_for <= today`. There is no daily cap or `.slice()` limit. If a large Email 1 batch went out on the same day, all corresponding Email 2 follow-ups fire in a single cron run 2-3 days later.

**Risk:** A batch of 50 Email 1s sent on the same day produces 50 Email 2s firing simultaneously. Monitor bounce rates on Email 2 days. If bounce rate spikes, add a cap to the Email 2 handler.

### Delivery math examples

| Email 1 batch size | Days to complete | Schedule |
|-------------------|-----------------|----------|
| 10 | 1 day | All on day 1 |
| 33 | 4 days | 10 + 10 + 10 + 3 |
| 41 | 4 days | 10 + 10 + 10 + 11 |
| 50 | 5 days | 10 + 10 + 10 + 20 (day 4 cap increases) |
| 100 | 6 days | 10 + 10 + 10 + 20 + 20 + 30 |

### Delay between sends

| Email type | Delay between sends |
|-----------|-------------------|
| Email 1 | 45–90 seconds (randomized) |
| Email 2 | 30–60 seconds (randomized) |

This section applies to TTMP delivery only. VLP uses Hunter.io which has its own sending limits.

---

## Phase 6 — Daily Monitoring

**Status:** NOT STARTED — Begins 2026-04-07 when first emails are delivered.

### Objective
Catch problems early and respond to engaged prospects. Takes 15 minutes each morning.

### Task 6.1 — Morning check

**Purpose:** Stay on top of campaign health and respond to interest.

**Steps:**
1. Open https://hunter.io/dashboard — check: sent, opened, replied, bounced
2. Open https://dashboard.stripe.com — check: new subscriptions, payments
3. Open https://mail.google.com — check: prospect replies

**Validation:**
- [ ] Bounce rate < 5% (if above: pause campaign, clean list)
- [ ] Any replies responded to within 24 hours
- [ ] Any Stripe activity logged

**Next:** Repeat daily. Phase 7 on Fridays.

---

## Phase 7 — Weekly Review

**Status:** NOT STARTED — First review scheduled for 2026-04-11 (Friday).

### Objective
Assess campaign performance and pipeline health. Adjust sending and sourcing.

### Task 7.1 — Friday review

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

**Step 3 — Push to R2 (5 scripts):**
```bash
node scale/push-email1-queue.js scale/gmail/email1/{date}-{n}-batch.csv
node scale/push-asset-pages.js scale/batches/scale-batch-{date}-{n}.json
node scale/push-batch-history.js scale/batches/scale-batch-{date}-{n}.json
node scale/push-master-csv.js
node scale/push-prospect-index.js scale/batches/scale-batch-{date}-{n}.json
```

The Worker cron picks up the email1 queue at 14:00 UTC daily. See [Worker Cron Reference](#worker-cron-reference) for sending limits.

**Step 4 — Verify delivery (next day):**
Check R2 queue for sent timestamps. Check inbox for bounces and replies.

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
| `scale/scripts/merge-intake.js` | Merge intake → master CSV | Repo Claude (one-time) |
| `scale/generate-vlp-batch.js` | Batch generator | Repo Claude (one-time) |
| `scale/prospects/vlp-master.csv` | Master prospect list (gitignored) | Merge script |
| `scale/prospects/archive/` | Archived intake files (gitignored) | Merge script |
| `scale/SCHEDULE.md` | Master action plan | This is your entry point |
| `scale/WORKFLOW.md` | This file | Operational detail |