# SCALE.md — VLP Global Client Acquisition System
**System:** Virtual Launch Pro (VLP) ecosystem
**Product focus:** TTMP (highest ROI) → WLVLP → VLP → TMP → TTTMP → TCVLP → GVLP → DVLP
**Last updated:** 2026-04-07

---

## 1. Objective

Build a repeatable system where:
- Analytics track every touchpoint from email send to Stripe payment
- Magnets deliver immediate value with personalization
- Outreach produces real case studies, reviews, and testimonials
- Tech stack stays free or lowest cost ($125/mo total)
- Workflow requires the least manual effort from operator (JLW)

**Revenue targets:**
- Breakeven: $125/mo (stack cost) = 7 TTMP token packs at $19 or 1 WLVLP template at $249
- Month 1 target: $500 (proof of concept)
- Month 3 target: $5,000/mo (pipeline compounding)
- Month 12 target: $10,000+/mo (SEO + email + referral combined)

---

## 2. Tech Stack

### Data layer ($5/mo)
| Tool | Plan | Cost | Purpose |
|------|------|------|---------|
| Cloudflare | Workers Paid | $5/mo | Workers, R2, KV, D1 — all 8 platforms |
| GitHub | Free | $0 | Repos, CI/CD via Cloudflare Pages |
| Stripe | Free | $0 | Payments — TMP Stripe + VLP Stripe accounts |
| Clay | Free | $0 | 100 credits/mo, prospect enrichment, Claygent |

### Outreach layer ($0/mo)
| Tool | Plan | Cost | Purpose |
|------|------|------|---------|
| Brevo | Free | $0 | Cold outreach email sequences |
| Resend | Free | $0 | Transactional email delivery |
| Cal.com | Free | $0 | Booking links for discovery + demo calls |
| Google Meet | Free | $0 | Video calls |
| Gmail | Free | $0 | API for transactional sends |
| Facebook | Free | $0 | Manual outreach — comments, DMs |
| LinkedIn | Free | $0 | Manual outreach — comments, DMs |
| Hunter | Free | $0 | Email verification |

### Execution layer ($120/mo)
| Tool | Plan | Cost | Purpose |
|------|------|------|---------|
| Claude | Max | $100/mo | Batch asset generation, platform dev, prompt authorship |
| ChatGPT | Plus | $20/mo | Supplementary generation, Canva site creation |

**Total: $125/mo**

---

## 3. Pipeline

| Step | Owner | Action | Output |
|------|-------|--------|--------|
| 1. Source | JLW | Scrub public data — NAEA, state boards, FOIA lists, LinkedIn, Google Maps | CSV/JSON prospect file |
| 2. Enrich | Clay + Claude | Validate emails, assign firm buckets, generate slugs | Enriched prospect records |
| 3. Generate | Claude | Process uploaded file — produce asset page data + email copy per prospect | JSON batch file |
| 4. Store | JLW / Worker | Push JSON to R2 — asset pages live at platform-specific routes | Asset pages served by VLP Worker |
| 5. Send | Brevo (cold) / Resend (transactional) | Deliver Email 1 with CTA linking to asset page | Tracked sends |
| 6. Track | VLP Worker | Log asset page views, CTA clicks, form submissions | D1 analytics |
| 7. Follow up | Brevo | Email 2 after 2-3 day delay | Tracked sends |
| 8. Close | JLW | Take booked calls on Google Meet, demo product, close sale | Stripe payment |

---

## 4. Prospect Sourcing

### Primary source
IRS FOIA sorted list — 66,000+ rows of U.S. tax professionals (CPAs, EAs, tax attorneys).
File: `scale/prospects/IRS_FOIA_SORTED_-_results-20260401-195853.csv`

### Secondary sources
- NAEA public directory (Enrolled Agents)
- State CPA society member lists
- LinkedIn title filters ("Enrolled Agent", "CPA", "Tax Attorney")
- Google Maps scraping (local service businesses — for WLVLP)

### CSV schema
See platform-specific SCALE.md files for column definitions. All platforms share the same source CSV with platform-specific tracking columns appended.

### Selection logic (per platform, per batch)
1. Filter: email_found not empty, not "undefined", not NaN
2. Filter: email_status not "invalid"
3. Filter: platform-specific `email_1_prepared_at` is empty
4. Sort: ascending by domain_clean (nulls last)
5. Select: first 50 eligible records (process all if fewer remain)

---

## 5. Email Sequences

### Engine 1 — Email (volume)

**Email 1 — Offer value**
- Personalized subject line referencing credential, city, or firm
- Body: pain point → free tool or asset offer → CTA
- CTA: "See your [asset type]" → platform-specific asset page
- Worker logs CTA click

**Email 2 — Present asset (2-3 days after Email 1)**
- References prior email
- Leads with asset page URL
- CTAs: asset page + Cal.com booking

**Email 3 — Final follow-up (5-7 days after Email 2)**
- Short, direct
- Single CTA: booking link
- Last touch — no further emails unless prospect engages

### Engine 2 — FB / LinkedIn (conversations)

**Comment 1:** Like or reply to a pain-point post (IRS frustrations, website complaints, tax season burnout)
**DM 1:** If they respond — discover pain points
**DM 2:** If they respond — qualify tool match
**DM 3:** If qualified — request email → add to next CSV batch → enters email flow

### Engine 3 — Bookings (closing)

**Booking 1 — Discovery:** Discover pain, qualify tool match, schedule demo if qualified
**Booking 2 — Demo:** Live product demo, walk through first purchase, close sale

---

## 6. Asset Pages

Each platform generates its own asset page type. All served by VLP Worker from R2.

| Platform | Asset type | URL pattern | R2 key pattern |
|----------|-----------|-------------|----------------|
| TTMP | Practice analysis | /asset/{slug} | vlp-scale/asset-pages/{slug}.json |
| WLVLP | Conversion leak report | /report/{slug} | vlp-scale/wlvlp-reports/{slug}.json |
| TMP | Service match report | /match/{slug} | vlp-scale/tmp-reports/{slug}.json |
| Others | TBD | TBD | TBD |

### Asset page CTAs (all platforms)
1. "Add this to my practice" / "See my upgraded site" → pricing page
2. "Let's talk" → Cal.com booking
3. "Learn more" → platform marketing page

---

## 7. Personalization Rules

### By credential (TTMP)
| Credential | Hrs/week | Hrs/year | Revenue opportunity |
|------------|----------|----------|---------------------|
| EA | 6.7 | 348 | $34,800-$104,400/yr |
| CPA | 5.0 | 260 | $39,000-$104,000/yr |
| JD/Attorney | 3.3 | 174 | $34,800-$87,000/yr |

### By firm bucket (all platforms)
- **solo_brand:** Reference DBA name, personal tone
- **local_firm:** Reference city, local practice context
- **national_firm:** Reference scale, staff consistency

### Slug convention
`{first}-{last}-{city}-{state}` — lowercase, hyphens, strip titles. Dedup: append -2, -3 on collision.

---

## 8. Output Files

Each batch run produces (per platform):

1. **JSON batch** — `scale/batches/{platform}-batch-{YYYY-MM-DD}.json` — full prospect + asset + email data
2. **Sending CSV** — `scale/{platform}/email1/{YYYY-MM-DD}-batch.csv` — columns: `email, first_name, subject, body`
3. **Updated source CSV** — tracking column stamped with ISO timestamp

All sending CSVs are RFC-4180 compliant. Jamie L Williams in every signature — never a placeholder.

---

## 9. Delivery Pipeline

This system prepares sending queues. Delivery depends on platform:

| Channel | Tool | Trigger |
|---------|------|---------|
| Cold outreach | Brevo | Manual import of sending CSV or API push |
| Transactional | Resend | VLP Worker triggers on events (purchase confirm, asset ready) |
| Asset pages | VLP Worker | Serves from R2 on request |

### Push commands (run after each batch)
Platform-specific — see each platform's SCALE.md for exact commands.

---

## 10. Analytics

### Email (Brevo + Resend)
Sends, opens, CTA clicks, bounces, unsubscribes, complaints, inbound replies

### Engagement (VLP Worker)
Asset page views per slug, CTA clicks per slug (which CTA), landing page views

### Bookings (Cal.com)
Bookings created, cancellations, reschedules, attended calls

### Sales (Stripe)
Payment succeeded, product/tier purchased, revenue per prospect (slug → account → purchase)

### Proof (VLP Worker)
Review form submissions, testimonial form submissions (text + optional video)

---

## 11. Tone Rules

Applies to all outreach across all platforms. No exceptions.

| Rule | Detail |
|------|--------|
| Direct | No fluff. State the benefit in the first sentence. |
| Professional but accessible | Written for tax professionals and business owners. Assume intelligence. |
| Specific | Use real numbers — hours saved, revenue recovered, token counts, prices. |
| Problem-first | Lead with the pain point, follow with the solution. |
| No emoji | Professional audience. None in email body, subject, or asset pages. |
| No exclamation marks | Calm confidence, not hype. |

---

## 12. Growth Plan

### Week 1 (4/4 - 4/11): Deploy and send
- All 8 repos deployed and functioning
- All repos interconnected via CTAs
- Email workflows built in priority order: TTMP → WLVLP → VLP → TMP → TTTMP → TCVLP → GVLP → DVLP
- WLVLP: upload new sites to lotto workflow operational
- Daily operator completes global workflow

### Week 2 (4/11 - 4/18): Social + booking scripts
- All repos with FB / LinkedIn workflows
  - Comment 1 script created and logged in repo
  - DM 1-3 scripts created and logged in repo
- All repos with booking workflows
  - Booking 1 script created, logged, practiced
  - Booking 2 script created, logged, practiced
- Daily operator completes global workflow

### Week 3 (4/18 - 4/25): Quality + next scale
- All repos: pages and flows hyper-quality tested
- All repos: review for next scale opportunity
- Daily operator completes global workflow

### Month 2-3: Scale and prove
- Scale to 100+ prospects per batch per platform
- Document first case studies from converted customers
- Build review/testimonial collection forms
- A/B test Email 2 delay timing (2 vs 5 vs 7 days)

### Month 4-6: Compound
- Publish case studies, reference in email copy
- Scale to 200+ prospects per batch
- Programmatic SEO pages live (WLVLP niche landing pages, TTMP code pages already exist)
- WLVLP: before/after generator live as public magnet
- WLVLP: instant personalization ("enter your business name → see your site") live
- Target: monthly revenue exceeds $125 stack cost consistently

---

## 13. Platform Priority (by ROI)

| Priority | Platform | Why first |
|----------|----------|-----------|
| 1 | TTMP | Highest need, lowest friction, $19 entry, 750K+ reachable audience |
| 2 | WLVLP | $249-399 per sale, 66K prospects with website URLs, Conversion Leak Report as magnet |
| 3 | VLP | Hub — every platform sale flows through VLP account + tokens |
| 4 | TMP | Taxpayer memberships, $9-39/mo recurring |
| 5 | TTTMP | Tax games + form tools, $9-39 token packs, cross-sell from TTMP |
| 6 | TCVLP | Form 843 generator, $10/mo, niche audience |
| 7 | GVLP | Gamified subscriptions, $9-39/mo, B2B2C model |
| 8 | DVLP | Developer marketplace, $2.99 intro tier, smallest audience overlap |

---

## 14. Non-Goals

SCALE does not:
- Send email directly (Brevo and Resend handle delivery)
- Build backend routes (those belong in VLP Worker)
- Modify prospect source CSVs beyond appending tracking columns
- Store PII in public-facing responses
- Contact any prospect more than once per email sequence step
- Operate without owner (JLW) sign-off on copy, routes, or batch sends
