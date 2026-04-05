# WORKFLOW.md — virtuallaunch.pro

Owner: Jamie L Williams
Last updated: 2026-04-05

---

## Daily Operations

### Morning checklist
1. Check Hunter.io dashboard — open rates, replies from yesterday's send
2. Check Stripe dashboard — any new subscriptions or payments
3. Check Cal.com — any booked discovery calls

### TTMP batch generation (TTMP repo)
1. cd to transcript.taxmonitor.pro
2. Run: node scale/generate-batch.js scale/prospects/{source}.csv
3. Upload scale/gmail/email1/{date}-batch.csv to Hunter.io
4. Push asset pages to R2: node scale/push-asset-pages.js scale/batches/scale-batch-{date}.json

### VLP batch generation (VLP repo)
1. cd to virtuallaunch.pro
2. Run: node scale/generate-vlp-batch.js scale/prospects/{source}.csv
3. Upload scale/hunter/vlp-email1-{date}.csv to Hunter.io
4. Push asset pages to R2: node scale/push-asset-pages.js scale/batches/vlp-batch-{date}.json

### End of day
- Review Hunter.io: open rates, click rates, replies
- Reply to any prospect responses within 24 hours
- Log any conversions (token purchases, membership signups)

---

## Weekly Operations
- Monday: Review past week metrics (sends, opens, clicks, conversions)
- Tuesday: Generate new batches if pipeline permits
- Wednesday: Check prospect pipeline health (remaining eligible count)
- Friday: Source new prospects if pipeline below 200 eligible

---

## Escalation Triggers
- Fewer than 50 eligible prospects remaining → source new CSV
- Bounce rate above 5% → pause sending, verify email list
- Spam complaints → immediately pause, review copy
- Stripe webhook failures → check Worker logs via wrangler tail

---

## Key Commands

### TTMP batch
```bash
cd C:\Users\eimaj\transcript.taxmonitor.pro
node scale/generate-batch.js scale/prospects/IRS_FOIA_SORTED_-_results-20260401-195853.csv
```

### VLP batch
```bash
cd C:\Users\eimaj\virtuallaunch.pro
node scale/generate-vlp-batch.js scale/prospects/{source}.csv
```

### Deploy VLP Worker
```bash
cd C:\Users\eimaj\virtuallaunch.pro
wrangler deploy
```

### Deploy TMP frontend
```bash
cd C:\Users\eimaj\taxmonitor.pro
npm run deploy
```

---

## Account URLs
- Stripe: https://dashboard.stripe.com
- Hunter.io: https://hunter.io/dashboard
- Cal.com: https://app.cal.com
- Cloudflare: https://dash.cloudflare.com
- VLP: https://virtuallaunch.pro
- TMP: https://taxmonitor.pro
- TTMP: https://transcript.taxmonitor.pro

---

## Troubleshooting

### Email not delivering
1. Check Hunter.io campaign status
2. Verify sender domain SPF/DKIM records
3. Check Gmail sending limits

### Asset page not loading
1. Check R2 for key: vlp-scale/asset-pages/{slug}.json
2. Verify Worker route handles /asset/{slug}
3. Check wrangler tail for errors

### Token grant not firing after payment
1. Check Stripe webhook logs for delivery failures
2. Verify webhook endpoint URL in Stripe dashboard
3. Check Worker logs: wrangler tail
4. Manual grant: POST /v1/admin/tokens/grant