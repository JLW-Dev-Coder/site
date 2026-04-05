# WORKFLOW.md — Virtual Launch Pro (VLP)

Owner: Jamie L Williams
Last updated: 2026-04-05

---

## What this file is

The daily operational playbook for running VLP SCALE email campaigns and monitoring the VLP ecosystem. This is Jamie's reference — not for Claude.

---

## First-Time Setup: Hunter.io

### 1. Create account (5 minutes)
- Go to https://hunter.io — click "Start free"
- Sign up with Google or email
- No credit card required

### 2. Connect Gmail (2 minutes)
- Avatar (top right) → Email accounts
- Connect email account → Gmail / Google Workspace
- Authorize Hunter to send from your Gmail
- Confirm green checkmark on connected account

### Domain warmup (first 4 weeks)
Google Workspace allows 2,000 emails/day but cold email from a new sender needs gradual ramp-up.

| Week | Daily limit in Hunter | Notes |
|------|----------------------|-------|
| 1 | 15 | Watch for bounces. If bounce rate > 5%, pause and clean list. |
| 2 | 25 | Check open rates. If < 15%, test new subject lines. |
| 3 | 40 | Monitor spam complaints. Any complaints = pause immediately. |
| 4+ | 50-100 | Only increase if bounce < 3%, no spam complaints. |

Never jump straight to high volume. Sender reputation takes weeks to build and seconds to destroy.

### Free plan limits
- 1 connected email account
- 500 recipients per campaign
- 25 email searches + 50 verifications/month
- Unlimited sequences

### When to upgrade
- Starter plan ($49/month) when you hit 500 recipients
- Pays for itself with 1 VLP Active membership sale ($79)

---

## Daily Operations

### Morning (15 minutes)

1. **Check Hunter.io dashboard**
   - How many sent yesterday
   - Who opened (warm leads — note these)
   - Who replied (respond within 24 hours)
   - Bounce rate (pause if above 5%)

2. **Check Stripe dashboard**
   - Any new subscriptions or one-time purchases
   - Any failed payments

3. **Check email inbox**
   - Prospect replies that came through Gmail directly
   - Support requests

### Batch generation (when pipeline permits)

**Generate VLP batch:**
```bash
cd C:\Users\eimaj\virtuallaunch.pro
node scale/generate-vlp-batch.js scale/prospects/{source}.csv
```

**Push asset pages to R2:**
```bash
node scale/push-vlp-asset-pages.js scale/batches/vlp-batch-{date}.json --exec
```

**Upload to Hunter.io:**
1. Open Hunter → Campaigns → your active campaign
2. Click Recipients → Import from CSV
3. Upload: scale/hunter/vlp-email1-{date}.csv
4. Map columns:
   - email → Email
   - first_name → First name
   - last_name → Last name
   - company → Company
   - subject → Subject
   - body → Email body
5. Click Import
6. Hunter auto-verifies emails from your free credits
7. Campaign sends automatically at your daily limit

### Creating a new Hunter campaign

1. Campaigns → New campaign
2. Name: "VLP SCALE — Batch {date}"
3. Select connected Gmail account
4. Add step → Email (leave subject/body blank — CSV overrides)
5. Sending settings:
   - Daily limit: 20-30
   - Window: 9:00 AM - 5:00 PM your timezone
   - Days: Monday - Friday only
6. Add step → Follow-up
   - Delay: 3 days
   - Condition: If no reply
   - Subject: Your practice analysis is ready, {{firstName}}
   - Body: reference asset page URL, pricing link, TTMP cross-sell
7. Import CSV, review, start

### Replying to prospects

When someone replies:
- If interested: link them to pricing page, offer to answer questions
- If asking questions: answer directly, be specific with numbers
- If not interested: thank them, no follow-up
- Never argue or send more than the sequence

---

## Weekly Operations (30 minutes, Fridays)

1. **Pipeline health**
   - How many eligible prospects remain in source CSV
   - If below 200: source new prospects next week

2. **Conversion review**
   - Emails sent this week
   - Opens / clicks / replies
   - Signups (free + paid)
   - Revenue

3. **Campaign performance**
   - Open rate below 20%? → test new subject lines
   - Reply rate below 2%? → test new body copy
   - Bounce rate above 3%? → clean prospect list

4. **TTMP cross-sell check**
   - Any TTMP token pack purchases from VLP prospects
   - These count as conversions even if they didn't buy a membership

---

## Escalation Triggers

- Fewer than 50 eligible prospects → source new CSV immediately
- Bounce rate above 5% → pause all campaigns, verify list
- Spam complaint → pause immediately, review copy with Claude
- Stripe webhook failures → check Worker logs: `wrangler tail`
- Hunter account suspended → check Hunter support, review sending patterns

---

## Key Commands

### VLP batch generation
```bash
cd C:\Users\eimaj\virtuallaunch.pro
node scale/generate-vlp-batch.js scale/prospects/{source}.csv
node scale/push-vlp-asset-pages.js scale/batches/vlp-batch-{date}.json --exec
```

### TTMP batch generation
```bash
cd C:\Users\eimaj\transcript.taxmonitor.pro
node scale/generate-batch.js scale/prospects/IRS_FOIA_SORTED_-_results-20260401-195853.csv
```

### Deploy VLP Worker
```bash
cd C:\Users\eimaj\virtuallaunch.pro
wrangler deploy
```

### Deploy VLP frontend
```bash
cd C:\Users\eimaj\virtuallaunch.pro\web
npm run pages:build
```

### Deploy TMP
```bash
cd C:\Users\eimaj\taxmonitor.pro
npm run deploy
```

### Deploy TTMP
```bash
cd C:\Users\eimaj\transcript.taxmonitor.pro
npm run deploy
```

### Check Worker logs
```bash
wrangler tail
```

---

## Account URLs

| Platform | URL |
|----------|-----|
| Stripe | https://dashboard.stripe.com |
| Hunter.io | https://hunter.io/dashboard |
| Cal.com | https://app.cal.com |
| Cloudflare | https://dash.cloudflare.com |
| VLP | https://virtuallaunch.pro |
| TMP | https://taxmonitor.pro |
| TTMP | https://transcript.taxmonitor.pro |
| TTTMP | https://taxtools.taxmonitor.pro |
| DVLP | https://developers.virtuallaunch.pro |
| GVLP | https://games.virtuallaunch.pro |
| TCVLP | https://taxclaim.virtuallaunch.pro |
| WLVLP | https://websitelotto.virtuallaunch.pro |

---

## Troubleshooting

### Email not delivering
1. Check Hunter campaign status — is it paused?
2. Check daily limit — has it been reached for today?
3. Verify Gmail account is still connected in Hunter
4. Check Gmail sending limits (500/day for Google Workspace, 100/day for free Gmail)

### Asset page not loading
1. Verify R2 key exists: `wrangler r2 object get virtuallaunch-pro/vlp-scale/asset-pages/{slug}.json`
2. Check Worker route handles /v1/scale/asset/{slug}
3. Check wrangler tail for errors

### Token grant not firing after payment
1. Check Stripe webhook delivery logs in Stripe dashboard
2. Verify webhook endpoint URL: https://api.virtuallaunch.pro/v1/webhooks/stripe
3. Check Worker logs: `wrangler tail`
4. Manual grant if needed: `POST /v1/admin/tokens/grant`

### Prospect CSV issues
- "undefined" in output → source CSV has empty email_found column
- 0 prospects processed → all already have vlp_email_1_prepared_at timestamps
- Skipped all → all already in TTMP pipeline (email_1_prepared_at not empty)
