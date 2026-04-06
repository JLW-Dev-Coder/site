---
name: vlp-scale-batch-generator
version: 1.0
owner: virtuallaunch.pro
purpose: Generates VLP membership outreach packages from FOIA/NAEA prospect CSV for Hunter.io cold email campaigns
---

# VLP SCALE Batch Generator

Converts a prospect CSV into outreach packages:
1. `scale/batches/vlp-batch-{YYYY-MM-DD}.json` — full data for asset pages
2. `scale/hunter/vlp-email1-{YYYY-MM-DD}.csv` — Hunter.io import file

Sender: **Jamie L Williams** — never use placeholders.
Terminology: use **practice analysis** — never "audit".

---

## 1. Purpose

Generate personalized VLP membership outreach packages from a prospect CSV, producing asset page data and Hunter.io-compatible email CSV files for cold email campaigns targeting tax professionals who want client leads.

---

## 2. Inputs

Source CSV (same FOIA/NAEA list as TTMP):

| Column | Type | Required |
|--------|------|----------|
| LAST_NAME | string | yes |
| First_NAME | string | yes |
| DBA | string | no |
| BUS_ADDR_CITY | string | yes |
| BUS_ST_CODE | string (2-letter) | yes |
| PROFESSION | string (EA/CPA/JD) | yes |
| domain_clean | string | no |
| email_found | string | yes |
| email_status | string | yes |
| firm_bucket | string (solo_brand/local_firm/national_firm) | yes |

Tracking columns (append if missing):
- vlp_email_1_prepared_at
- vlp_email_2_prepared_at

---

## 3. Preconditions

- email_found is not empty, not "undefined", not NaN
- email_status is not "invalid"
- vlp_email_1_prepared_at is empty
- email_1_prepared_at may or may not be empty (TTMP pipeline is separate — a prospect can be in both pipelines)
- BUT: if email_1_prepared_at is not empty AND vlp_email_1_prepared_at is empty, this prospect was already contacted by TTMP — SKIP for VLP Phase 1 to avoid double-contacting. Revisit in Phase 2 after initial VLP results are in.

---

## 4. Selection Logic

1. Filter: email_found not empty, not "undefined", not NaN
2. Filter: email_status not "invalid"
3. Filter: vlp_email_1_prepared_at is empty
4. Filter: email_1_prepared_at is empty (exclude TTMP pipeline)
5. Sort: ascending by domain_clean (nulls last)
6. Select: first 50 eligible records

---

## 5. Execution Logic

### Slug
`{first}-{last}-{city}-{state}` — lowercase, hyphens, strip titles (Dr./Mr./Jr.)
Dedup: append -2, -3 on collision.

### Tier value by credential

| Credential | Typical billing rate | Client volume | Annual value of 5 new clients |
|------------|---------------------|---------------|-------------------------------|
| EA | $100-300/hr | 50-200/yr | $15,000-$90,000 |
| CPA | $150-400/hr | 100-500/yr | $22,500-$120,000 |
| JD/Attorney | $200-500/hr | 30-100/yr | $18,000-$150,000 |

### Asset page object

```json
{
  "headline": "{First}, here's what your {City} practice is leaving on the table",
  "subheadline": "A practice analysis for {credential_label} who want more qualified clients",
  "client_gap_analysis": [
    "No searchable directory listing — taxpayers can't find you",
    "No online intake workflow — prospects drop off before engaging",
    "No automated client matching — you wait for referrals instead of earning leads"
  ],
  "new_client_value": "$15,000-$90,000/yr from 5 additional clients",
  "tier_comparison": {
    "active": { "price": "$79/mo", "value": "Directory listing + 2 transcript tokens + 5 game tokens" },
    "featured": { "price": "$199/mo", "value": "Sponsored placement + 5 transcript tokens + 15 game tokens" },
    "premier": { "price": "$399/mo", "value": "Placement on 3 platforms + 10 transcript + 40 game tokens" }
  },
  "ttmp_crosssell": {
    "pitch": "Not ready for a membership? Try transcript automation first.",
    "url": "https://transcript.taxmonitor.pro/pricing",
    "price": "10 analyses for $19 — no commitment"
  },
  "cta_pricing_url": "https://virtuallaunch.pro/pricing",
  "cta_directory_url": "https://taxmonitor.pro/directory",
  "cta_booking_url": "https://cal.com/tax-monitor-pro/discovery"
}
```

### Personalization by firm_bucket

**solo_brand:**
- Subject: "{First} — {PROFESSION}s running {DBA} are invisible to taxpayers searching online"
- Headline: "{First}, here's what your {DBA} practice is leaving on the table"

**local_firm:**
- Subject: "{First} — taxpayers in {City} are searching for help you're not showing up for"
- Headline: "{First}, here's what your {City} practice is leaving on the table"

**national_firm (or fallback):**
- Subject: "{First} — your next 5 clients are searching online right now"
- Headline: "{First}, here's what your practice is leaving on the table"

### Email 1 body (plain text)

```
{First},

Taxpayers in {City} search online for tax help every day. Most never find you because you're not in the places they're looking.

The Tax Monitor Pro network puts your profile in front of taxpayers who need exactly what you offer — {credential_label} with experience in {specialty_placeholder}. Listings start at $79/mo and include transcript automation tokens so your practice gets more efficient at the same time.

Here's a quick practice analysis I put together for {firm_or_city_practice}:
https://virtuallaunch.pro/asset/{slug}

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

### Email 2 body

- Subject: "Your practice analysis is ready, {First} — {new_client_value} on the table"
- Timing: 3 days after Email 1
- References: prior email + asset page
- Lead with asset page URL
- CTAs: pricing + TTMP cross-sell

---

## 6. Output

### Batch JSON
Path: `scale/batches/vlp-batch-{YYYY-MM-DD}.json`

Per-prospect:
```json
{
  "slug": "...",
  "email": "...",
  "name": "...",
  "credential": "EA",
  "city": "...",
  "state": "...",
  "firm": "...",
  "firm_bucket": "solo_brand",
  "domain_clean": "...",
  "asset_page": { ... },
  "email_1": { "subject": "...", "body": "..." },
  "email_2": { "subject": "...", "body": "..." }
}
```

### Hunter.io CSV
Path: `scale/hunter/vlp-email1-{YYYY-MM-DD}.csv`

Columns exactly: `email,first_name,last_name,company,subject,body`
- RFC-4180 compliant
- Body field quoted, contains newlines
- Jamie L Williams always in signature

### Updated source CSV
Write `vlp_email_1_prepared_at = ISO timestamp` back to source after batch.

---

## 7. Side Effects

- Source CSV updated with vlp_email_1_prepared_at timestamp
- Batch JSON written to scale/batches/
- Hunter CSV written to scale/hunter/

---

## 8. Failure Handling

- Invalid email → skip record, log to console
- Missing required field → skip record, log to console
- Slug collision → append -2, -3
- Fewer than 50 eligible → process all remaining, log count

---

## 9. Constraints

- Never output email: "undefined"
- Never contact a prospect already in TTMP pipeline (email_1_prepared_at is not empty)
- No emoji anywhere
- No exclamation marks
- Jamie L Williams always in signature — never placeholder

---

## 10. Example

Input:
```json
{
  "First_NAME": "Sarah",
  "LAST_NAME": "Chen",
  "DBA": "Chen Tax Services",
  "BUS_ADDR_CITY": "Austin",
  "BUS_ST_CODE": "TX",
  "PROFESSION": "CPA",
  "email_found": "schen@example.com",
  "email_status": "valid",
  "firm_bucket": "solo_brand",
  "domain_clean": "chentaxservices.com"
}
```

Output slug: `sarah-chen-austin-tx`

Output email_1 subject: `Sarah — CPAs running Chen Tax Services are invisible to taxpayers searching online`

---

## 11. Non-Goals

- Does not send email (Hunter.io handles delivery)
- Does not push to R2 (separate step)
- Does not create Stripe products or memberships
- Does not modify any VLP Worker routes