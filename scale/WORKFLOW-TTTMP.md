# WORKFLOW.md — taxtools.taxmonitor.pro

Owner: Jamie L Williams
Last updated: 2026-04-04

---

## Daily Operations

### Morning checklist
1. Check Stripe dashboard — any new token purchases
2. Check support inbox — any new tickets via `/contact`
3. Check Cloudflare Pages — build status, any failed deploys

### Content review
- Verify all game pages load correctly
- Check token purchase flow end-to-end (monthly spot check)
- Review any support tickets and respond within 24 hours

### End of day
- Log any token purchases or conversions
- Note any broken pages or user-reported issues

---

## Weekly Operations
- Monday: Review past week metrics (token sales, page views, support tickets)
- Wednesday: Check game content — any updates needed based on tax season changes
- Friday: Review affiliate program activity (commissions, payouts)

---

## Escalation Triggers
- Stripe payment failures → check webhook logs at VLP Worker
- Game not loading → check `public/games/` HTML files and token gating flow
- Login broken → verify VLP API `/v1/auth/session` endpoint is responding
- Build failure → check `npm run build` output, fix TypeScript errors

---

## Key Commands

### Local development
```bash
cd C:\Users\eimaj\taxtools.taxmonitor.pro
npm run dev
```

### Production build
```bash
npm run build
```

### Deploy
Push to main → Cloudflare Pages auto-deploys

---

## Account URLs
- Stripe: https://dashboard.stripe.com
- Cloudflare: https://dash.cloudflare.com
- VLP API: https://api.virtuallaunch.pro
- TMP: https://taxmonitor.pro
- TTTMP: https://taxtools.taxmonitor.pro

---

## Troubleshooting

### Token purchase not completing
1. Check Stripe webhook logs for delivery failures
2. Verify VLP Worker is processing checkout.session.completed events
3. Check browser console for API errors on `/v1/checkout/status`

### Game not granting access
1. Verify token balance via `/v1/tokens/balance/{account_id}`
2. Check `/v1/games/access` response in network tab
3. Verify game HTML file exists in `public/games/`

### Magic link not arriving
1. Check VLP API logs for `/v1/auth/magic-link/request`
2. Verify email address is valid
3. Check spam folder
