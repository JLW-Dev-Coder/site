# VLP SCALE — Membership Outreach System

**Target:** Tax professionals (EA/CPA/Attorney) seeking client leads
**Channel:** Cold email via Hunter.io  
**Goal:** VLP membership conversions (Active $79/mo, Featured $199/mo, Premier $399/mo)
**Sender:** Jamie L Williams — never placeholder

---

## 1. Overview

VLP SCALE generates personalized outreach packages from FOIA/NAEA prospect lists, targeting tax professionals who want more qualified clients. The system creates asset pages and Hunter.io-compatible email sequences focused on practice growth through directory listings and transcript automation.

---

## 2. Pipeline Architecture

```
Prospect CSV → Batch Generator → Asset Pages + Hunter CSV → Email Delivery → Conversions
```

### Components
- **Batch Generator:** `scale/generate-vlp-batch.js` (Node.js script)
- **Asset Pages:** Personalized practice analysis pages at `virtuallaunch.pro/asset/{slug}`
- **Hunter.io:** Email delivery, tracking, and sequences
- **VLP Worker:** Asset page serving and conversion tracking

---

## 3. Target Audience

Tax professionals from FOIA/NAEA lists with valid email addresses who are NOT already in TTMP pipeline to avoid double-contacting during Phase 1.

### Credentials
- **EA (Enrolled Agents):** $100-300/hr, 50-200 clients/yr, $15,000-$90,000 value from 5 new clients
- **CPA (Certified Public Accountants):** $150-400/hr, 100-500 clients/yr, $22,500-$120,000 value from 5 new clients  
- **JD/Attorney:** $200-500/hr, 30-100 clients/yr, $18,000-$150,000 value from 5 new clients

### Firm Types
- **solo_brand:** Independent practitioners with DBA
- **local_firm:** Regional/city-based practices  
- **national_firm:** Large multi-location firms

---

## 4. Selection Criteria

### Required Fields
- email_found: valid email address
- email_status: not "invalid"
- First_NAME, LAST_NAME: prospect identification
- BUS_ADDR_CITY, BUS_ST_CODE: location targeting
- PROFESSION: EA/CPA/JD credential verification
- firm_bucket: personalization routing

### Exclusion Filters
- vlp_email_1_prepared_at is not empty (already contacted for VLP)
- email_1_prepared_at is not empty (avoid TTMP double-contact in Phase 1)
- email_found empty, "undefined", or NaN
- email_status = "invalid"

### Batch Size
**Phase 1:** 50 prospects per batch  
**Phase 2:** Scale based on Phase 1 results (target 100-200/batch)

---

## 5. Prospect Sourcing

Same FOIA/NAEA list as TTMP but with VLP-specific filtering:

### Source CSV Columns
| Column | Type | Purpose |
|--------|------|---------|
| First_NAME | string | Email personalization |
| LAST_NAME | string | Slug generation |
| DBA | string | Solo practice branding |
| BUS_ADDR_CITY | string | Location targeting |
| BUS_ST_CODE | string | State abbreviation |
| PROFESSION | string | Credential-based messaging |
| domain_clean | string | Sort order for batching |
| email_found | string | Delivery target |
| email_status | string | Validity filter |
| firm_bucket | string | Message personalization |

### Tracking Columns
- **vlp_email_1_prepared_at:** VLP Phase 1 timestamp
- **vlp_email_2_prepared_at:** VLP follow-up timestamp
- **email_1_prepared_at:** TTMP pipeline timestamp (exclusion filter)

---

## 6. Email Sequences

### Email 1: Practice Analysis Introduction

**Timing:** Immediate (Hunter.io batch import)

**Subject Lines by firm_bucket:**
- **solo_brand:** "{First} — {PROFESSION}s running {DBA} are invisible to taxpayers searching online"
- **local_firm:** "{First} — taxpayers in {City} are searching for help you're not showing up for"
- **national_firm:** "{First} — your next 5 clients are searching online right now"

**Body Template:**
```
{First},

Taxpayers in {City} search online for tax help every day. Most never find you because you're not in the places they're looking.

The Tax Monitor Pro network puts your profile in front of taxpayers who need exactly what you offer — {credential_label} with experience in general tax preparation. Listings start at $79/mo and include transcript automation tokens so your practice gets more efficient at the same time.

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

### Email 2: Follow-up with Value Focus

**Timing:** 3 days after Email 1  
**Subject:** "Your practice analysis is ready, {First} — {new_client_value} on the table"

**Strategy:**
- Reference prior email and asset page
- Lead with asset page URL  
- Emphasize annual value from 5 new clients
- Include pricing + TTMP cross-sell CTAs
- Maintain direct, problem-focused tone

---

## 7. Asset Pages

### URL Pattern
`https://virtuallaunch.pro/asset/{slug}`

**Slug Format:** `{first}-{last}-{city}-{state}` (lowercase, hyphens, deduplicated)

### Data Schema
```json
{
  "headline": "{First}, here's what your {City/DBA} practice is leaving on the table",
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

### CTAs (Call to Actions)
1. **Primary:** VLP membership tiers at /pricing
2. **Secondary:** TMP directory listing preview at taxmonitor.pro/directory
3. **Alternative:** TTMP transcript tool trial 
4. **Discovery:** Cal.com booking for personal consultation

---

## 8. Personalization Rules

### By Credential
- **EA:** Focus on efficiency, competitive rates, IRS representation
- **CPA:** Emphasize expertise breadth, premium positioning, business clients
- **JD/Attorney:** Highlight specialized knowledge, complex cases, high-value clients

### By Firm Bucket  
- **solo_brand:** DBA recognition, personal brand building, direct taxpayer connection
- **local_firm:** Geographic market share, community presence, local SEO
- **national_firm:** Lead generation, systematic growth, multi-location efficiency

### Value Proposition Matching
- **Active ($79/mo):** Basic directory listing, transcript automation introduction
- **Featured ($199/mo):** Sponsored placement, moderate token allocation  
- **Premier ($399/mo):** Multi-platform presence, maximum token benefits

---

## 9. Output Files

### Batch JSON
**Path:** `scale/batches/vlp-batch-{YYYY-MM-DD}.json`

**Contains:** Complete asset page data, email content, prospect metadata for VLP Worker serving

### Hunter.io CSV  
**Path:** `scale/hunter/vlp-email1-{YYYY-MM-DD}.csv`

**Format:** RFC-4180 compliant with columns: `email,first_name,last_name,company,subject,body`

**Requirements:**
- Body field properly quoted for multi-line content
- Jamie L Williams signature in every email
- No emoji or exclamation marks
- Company field defaults to "{First} {Last} Tax Services" if DBA missing

---

## 10. Delivery Pipeline

### Hunter.io Integration  
VLP SCALE uses Hunter.io for email delivery (not VLP Worker cron).

**Process:**
1. Generate batch via `node scale/generate-vlp-batch.js`
2. Import `scale/hunter/vlp-email1-{date}.csv` to Hunter Sequences
3. Hunter handles sending, tracking, bounces, and unsubscribes
4. VLP Worker tracks asset page views and conversions

**Advantages:**
- Professional sending reputation
- Automatic bounce handling  
- CAN-SPAM compliance
- Click and open tracking
- Unsubscribe management

### Not VLP Worker Responsibility
- Email delivery (Hunter.io handles)
- Bounce processing (Hunter.io handles)
- Unsubscribe compliance (Hunter.io handles)
- Sender reputation management (Hunter.io handles)

---

## 11. Analytics

### Hunter.io Metrics
- **Open rates:** Email subject line performance
- **Click rates:** Asset page interest level  
- **Reply rates:** Direct engagement and interest
- **Bounce rates:** List quality validation

### VLP Worker Metrics  
- **Asset page views:** `/asset/{slug}` endpoint analytics
- **CTA clicks:** Pricing page, directory, booking conversions
- **Membership signups:** Stripe webhook attribution
- **TTMP cross-sell:** Transcript tool conversions

### Attribution Tracking
- **Source:** VLP SCALE campaign
- **Medium:** Email  
- **Campaign:** vlp-batch-{date}
- **Content:** {slug} for per-prospect tracking

---

## 12. Tone Rules

### Writing Style  
- **Direct:** Lead with the problem, not the solution
- **Specific:** Use exact numbers ($79/mo, 5 new clients, 30 seconds)
- **Professional:** No emoji, no exclamation marks, formal business tone
- **Problem-first:** Identify pain before presenting solution
- **Action-oriented:** Every sentence should drive toward the CTA

### Terminology Standards
- Use "practice analysis" — never "audit"
- Use "taxpayers" — not "clients" or "customers" 
- Use "directory listing" — not "profile" or "page"
- Use "transcript automation" — not "transcript processing"

### Signature Consistency
Always: "Jamie L Williams, Virtual Launch Pro, virtuallaunch.pro"
Never: placeholders, variables, or alternative names

---

## 13. Growth Plan

### Phase 1: Validation (Current)
- **Batch Size:** 50 prospects
- **Target:** Non-TTMP prospects only
- **Focus:** Conversion rate optimization
- **Timeline:** 2-4 weeks testing

### Phase 2: Scale Based on Results  
- **Batch Size:** 100-200 prospects (based on Phase 1 performance)
- **Target:** Include TTMP prospects with different messaging
- **Focus:** Volume optimization
- **Timeline:** Post-validation expansion

### Success Metrics
- **Email Performance:** >20% open rate, >3% click rate
- **Asset Page Conversion:** >2% pricing page visits  
- **Membership Conversion:** >0.5% signup rate from asset page traffic
- **TTMP Cross-sell:** >1% trial conversion rate

---

## 14. Non-Goals

### What VLP SCALE Does NOT Do
- **No booked calls required:** Self-serve conversion through pricing page
- **No sales team follow-up:** Automated nurture through email sequences  
- **No phone outreach:** Email-only channel
- **No custom proposals:** Standard tier messaging only
- **No negotiated pricing:** Fixed membership rates only

### Integration Boundaries
- **Email delivery:** Hunter.io responsibility  
- **Asset page serving:** VLP Worker responsibility
- **Conversion tracking:** Split between Hunter.io (email) and VLP Worker (web)
- **Payment processing:** Stripe via VLP Worker (existing flow)