# WORKFLOW.md — transcript.taxmonitor.pro
Owner: Jamie L Williams
Last updated: 2026-04-04

---

## 1. Daily Operations

### Morning checklist
- Check Hunter.io dashboard for previous batch delivery status
- Review any email replies or bounces in Gmail
- Confirm R2 asset pages are live for previous batch

### Batch generation
1. Run batch selection:
   ```
   node scale/generate-batch.js
   ```
2. Open Claude Code in transcript.taxmonitor.pro repo
3. Instruct Claude Code to generate copy from the batch selection file
4. Verify outputs:
   - `scale/batches/scale-batch-{YYYY-MM-DD}-{N}.json`
   - `scale/gmail/email1/{YYYY-MM-DD}-{N}-batch.csv`

### R2 push (after batch generation)
```bash
# Push email1 queue
node scale/push-email1-queue.js scale/gmail/email1/{YYYY-MM-DD}-{N}-batch.csv

# Push asset pages
node scale/push-asset-pages.js scale/batches/scale-batch-{YYYY-MM-DD}-{N}.json

# Push Email 2 queue
node scale/push-email2-queue.js scale/batches/scale-batch-{YYYY-MM-DD}-{N}.json

# Push batch history manifest
node scale/push-batch-history.js scale/batches/scale-batch-{YYYY-MM-DD}-{N}.json

# Push updated master CSV
node scale/push-master-csv.js

# Push prospect index
node scale/push-prospect-index.js scale/batches/scale-batch-{YYYY-MM-DD}-{N}.json
```

### Sending
- Upload Gmail CSV to Hunter.io Campaigns
- Verify sender: Jamie L Williams via configured Gmail account
- Confirm sending schedule and throttle settings

### End of day
- Review open rates and click-through in Hunter.io
- Check for replies requiring manual response
- Log any issues or observations

---

## 2. Weekly Operations

- **Pipeline health:** Check remaining eligible prospects (`email_1_prepared_at` empty count)
- **Conversion review:** Emails sent > clicks > signups > payments in Stripe
- **Content refresh:** Update asset page copy based on click/reply performance
- **Prospect sourcing:** If pipeline drops below 200 eligible, prepare next FOIA batch enrichment

---

## 3. Escalation Triggers

- Pipeline exhausted (fewer than 50 eligible Email 1 records)
- Bounce rate exceeds 5%
- Spam complaints received
- Stripe payment failures
- Asset page 404s on live links

---

## 4. Key Commands Reference

| Command | Purpose |
|---------|---------|
| `node scale/generate-batch.js` | Select next 50 prospects, write batch selection |
| `npm run cf:build` | Production build |
| `npm run deploy` | Build + deploy to Cloudflare Workers |
| `npm run preview` | Build + local preview |
| `node scale/push-email1-queue.js <csv>` | Push email queue to R2 |
| `node scale/push-asset-pages.js <json>` | Push asset pages to R2 |
| `node scale/push-batch-history.js <json>` | Append batch to history manifest |
| `node scale/push-master-csv.js` | Push updated master CSV to R2 |
| `node scale/push-prospect-index.js <json>` | Push prospect email-to-slug index |
| `node scale/scripts/merge-intake.js` | Merge new prospects into master CSV |

---

## 5. Account Credentials Reference

| Platform | URL | Purpose |
|----------|-----|---------|
| Hunter.io | hunter.io/campaigns | Email sending campaigns |
| Stripe | dashboard.stripe.com | Payment processing |
| Cal.com | cal.com/vlp | Discovery call scheduling |
| Cloudflare | dash.cloudflare.com | Workers, R2, KV |
| Gmail | mail.google.com | Outreach sending account |

No passwords here — use password manager.

---

## 6. Troubleshooting

| Issue | Check |
|-------|-------|
| Email not sending | Hunter.io campaign status, Gmail account auth |
| Asset page 404 | R2 key exists at `vlp-scale/asset-pages/{slug}.json` |
| Batch script fails | Lockfile at `scale/prospects/.batch-in-progress` — remove if stale |
| Deploy fails | GitHub Actions log, `npm run cf:build` locally |
| CSV merge refuses | Check lockfile, verify intake CSV headers match expected schema |
