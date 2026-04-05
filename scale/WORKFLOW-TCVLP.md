# WORKFLOW.md — TaxClaim Virtual Launch Pro (TCVLP)

**Owner:** James (eimaj)
**Last updated:** 2026-04-04

---

## 1. Daily Operations

### Morning Checklist
- [ ] Check Stripe dashboard for new subscriptions / failed payments
- [ ] Review any Form 843 generation requests pending
- [ ] Check support tickets (submitted via /support/ticket endpoint)
- [ ] Verify landing pages are live and rendering correctly

### Landing Page Management
- New tax professional onboards → landing page generated via `/landing-page/create`
- Onboarding data submitted via `/landing-page/onboarding`
- Verify branding, logo, and welcome message display correctly

### Form 843 Generation
- Taxpayer submits data via landing page
- Form 843 generated via `/forms/843/generate` endpoint
- PDF delivered to taxpayer dashboard
- Verify penalty & interest calculations against IRS transcript data

### End of Day
- Review new signups and onboarding completions
- Check for any failed checkout sessions in Stripe
- Log any support escalations

## 2. Weekly Operations

- **Subscription health:** Review active vs churned subscribers
- **Form generation volume:** How many 843s generated this week?
- **Landing page performance:** Any broken pages or rendering issues?
- **Support review:** Open tickets, resolution time, common issues
- **Content refresh:** Update demo page if conversion is low

## 3. Escalation Triggers

- Stripe payment failures > 3 in a day
- Form 843 generation errors (endpoint returning 500s)
- Landing page rendering broken on mobile
- Support ticket unanswered > 24 hours
- IRS transcript data unavailable from TMP

## 4. Key Commands Reference

```bash
# Local development (when package.json exists)
npm run dev          # Start local dev server
npm run build        # Production build

# Worker testing
# No wrangler.toml yet — needs migration setup

# Git
git status
git add -A && git commit -m "description"
```

## 5. Account Credentials Reference

| Platform | URL | Purpose |
|----------|-----|---------|
| Stripe | dashboard.stripe.com | Subscriptions, payments |
| Cloudflare | dash.cloudflare.com | Workers, DNS, Pages |
| GitHub | github.com/eimaj | Source control |

## 6. API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/reviews/submit` | POST | Submit review |
| `/reviews` | GET | Get reviews by eventId/proId |
| `/payments/checkout` | POST | Create Stripe checkout |
| `/forms/843/generate` | POST | Generate Form 843 |
| `/forms/843/submit` | POST | Submit taxpayer 843 |
| `/landing-page/create` | POST | Generate landing URL |
| `/landing-page/onboarding` | POST | Submit onboarding data |
| `/support/ticket` | POST | Submit support ticket |
| `/support/status` | POST | Check support status |

## 7. Troubleshooting

- **843 not generating** → Check payload has eventId, taxpayerId, penalties, interest
- **Checkout failing** → Verify proId maps to a valid Stripe payment link
- **Landing page blank** → Check URL params (eventId, proId, branding, welcomeMessage required)
- **Auth errors (401)** → Verify Bearer token in Authorization header
- **Support status unknown** → Confirm clientReferenceNumber is valid
