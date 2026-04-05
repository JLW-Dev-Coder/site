# WORKFLOW.md — taxmonitor.pro

**Owner:** Jamie L Williams
**Last updated:** 2026-04-04

---

## 1. Daily Operations

### Morning checklist
1. Check Cloudflare Analytics for directory traffic (taxmonitor.pro dashboard)
2. Check Stripe dashboard for new TMP membership signups
3. Review any new taxpayer inquiries submitted via /inquiry flow
4. Check email for contact form submissions or support requests

### Expected state
- Directory loads with all active VLP member profiles
- Pricing page displays current TMP tiers ($9/$19/$39)
- Inquiry → Intake → Offer → Agreement → Payment flow completes without errors

### Alert state
- Directory returns empty or errors (VLP API down)
- Stripe checkout fails or returns errors
- Inquiry flow drops users mid-funnel

---

## 2. Weekly Operations

### Monday — Traffic review
- Review Cloudflare Analytics: page views, unique visitors, top pages
- Check directory search/filter usage patterns
- Note any traffic spikes from referral sources

### Wednesday — Membership review
- Check Stripe for new TMP subscriptions (Essential/Plus/Premier)
- Review token usage across active members
- Check for failed payments or cancellations

### Friday — Content and funnel check
- Walk through inquiry → payment flow end-to-end
- Verify directory profiles are current (new VLP members appearing)
- Review and respond to any pending support requests

---

## 3. Monitoring Channels

| What | Where |
|------|-------|
| Site traffic | Cloudflare Analytics (taxmonitor.pro) |
| Membership signups | Stripe Dashboard |
| Taxpayer inquiries | VLP Worker API / email notifications |
| Directory profiles | VLP API → /directory page |
| Support requests | Contact form → email |

---

## 4. Escalation Triggers

- Directory returns 0 profiles for more than 1 hour
- Stripe checkout flow broken (test with $0 coupon)
- Inquiry submissions not reaching VLP Worker
- Auth flow (magic link / Google OAuth) failing
- SSL certificate expiry warning from Cloudflare

---

## 5. Key URLs

| Service | URL |
|---------|-----|
| TMP site | taxmonitor.pro |
| Stripe Dashboard | dashboard.stripe.com |
| Cloudflare Dashboard | dash.cloudflare.com |
| Cal.com Dashboard | app.cal.com |
| VLP API | api.virtuallaunch.pro |

---

## 6. Troubleshooting

- **Directory empty** → Check VLP API status, verify api.virtuallaunch.pro responds
- **Checkout fails** → Check Stripe API keys, verify createCheckoutSession in lib/api.ts
- **Auth broken** → Check vlp_session cookie, verify magic link endpoint
- **Profile not loading** → Check query param ?id=, verify getProfile API call
- **Build fails** → Run `npm run build`, check for TypeScript errors
