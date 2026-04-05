# DVLP — Operational Workflow

**Product:** Developers VLP
**Owner:** Jamie Williams
**Last updated:** 2026-04-04

---

## Daily Operations

### Morning Checklist

1. **Check operator dashboard** (`/operator`)
   - New submissions? Review and set status (active/pending/denied)
   - New support tickets? Reply or escalate
   - Published profile count — any new developers to approve?

2. **Check Stripe dashboard**
   - New subscriptions or cancellations?
   - Any failed payments requiring follow-up?

3. **Check email**
   - Developer replies to onboarding confirmation
   - Client inquiries from find-developers intake
   - Bounce notifications from Resend

### Developer Management

- Review new onboarding submissions in operator dashboard
- Toggle `publish_profile` for approved developers
- Send welcome email via canned responses
- Match developers to open job posts

### Client Intake

- Review new find-developer requests
- Match with published developers by skill/availability
- Send operator post notifications to matched developers

### End of Day

- Review open tickets — any pending >24h?
- Check analytics for submission trends
- Log any issues or follow-ups needed

---

## Weekly Operations

### Monday
- **Job match cron runs** (automatic — `0 9 * * 1` UTC)
  - Sends notifications to eligible developers
  - Check cron run receipts in R2 (`cron-job-match-runs/`)
- Review weekly analytics (submissions, active developers, page views)

### Wednesday
- Pipeline health: How many active + published developers?
- Content review: Are reviews page and developer directory current?
- Pricing check: Any churn signals on $2.99 tier?

### Friday
- Conversion review: onboarding starts → completions → payments
- Client intake review: requests received → matches made
- Plan next week's outreach or content updates

---

## Escalation Triggers

| Trigger | Action |
|---------|--------|
| Stripe payment failures >3 in a day | Check Stripe webhook, verify Worker health |
| Cron job match not running | Check Worker `developers-virtuallaunch-pro-api` on dashboard |
| Bounce rate above 5% | Review Resend logs, check email list quality |
| No new submissions in 7 days | Review onboarding flow, check for errors |
| Operator dashboard errors | Check VLP Worker logs, verify API endpoints |

---

## Key Commands Reference

```bash
# Local development
npm run dev                                    # Start dev server
npm run build                                  # Static export to out/

# Seed scripts (require env vars)
CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_API_TOKEN=<token> node scripts/seed-canned-responses.js
node scripts/backfill-email-index.js
node scripts/dedupe-onboarding-records.js

# Deploy (automatic via git push, or manual)
# wrangler pages deploy out/
```

---

## Account Credentials Reference

| Platform | URL | Purpose |
|----------|-----|---------|
| Cloudflare Dashboard | dash.cloudflare.com | Pages deploy, R2, KV, Workers |
| Stripe Dashboard | dashboard.stripe.com | Payments, subscriptions, webhooks |
| Resend Dashboard | resend.com | Bulk email delivery |
| Google Cloud Console | console.cloud.google.com | Gmail API credentials |
| Cal.com | cal.com | Scheduling integration |
| GitHub | github.com | Source control |

Email sending account: `team@virtuallaunch.pro`

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| Onboarding form not submitting | VLP Worker health, check `/v1/dvlp/onboarding` response |
| Success page stuck on "processing" | Stripe webhook delivery in Stripe dashboard |
| Operator dashboard won't load | `getSession()` returning null? Check auth cookies |
| Developer not appearing in directory | `publish_profile` flag, `status` must be `active` |
| Emails not sending | Check Resend/Gmail API keys, VLP Worker logs |
| Build failing | Run `npm run build` locally, check TypeScript errors |
| Static pages stale after deploy | Clear Cloudflare cache, verify `out/` contents |
