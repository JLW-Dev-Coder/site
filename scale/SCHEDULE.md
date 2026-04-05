# MASTER ACTION PLAN — VLP Ecosystem

Owner: Jamie L Williams
Last updated: 2026-04-05

This is your one file. Open this. Do the next unchecked item.

---

## How this works

Everything flows in order. Do not skip ahead.
When you finish an item, check it off and note the date.
When you hit a problem, open Claude chat, describe the problem, get a fix.
Come back here, re-test, check it off.

Reference files (only open these when this plan tells you to):
- scale/WORKFLOW.md — Hunter.io setup guide + daily ops
- scale/GLOBAL-TESTING-ORDER.md — detailed testing checklists
- scale/vlp-testing-checklist.md (and others) — per-platform test items

---

## PHASE A — Deploy (do this first, do it once)

Deploy in this exact order. VLP Worker first because everything depends on it.

- [x] Deploy VLP Worker: wrangler deploy — Success, v2e4b3934
- [x] Deploy VLP Frontend: Cloudflare Pages git integration (auto-deployed)
- [x] Deploy TTMP: npm run deploy — Success, 497 pages
- [x] Deploy TMP: Cloudflare Pages git integration — Success, commit fbc3f76
- [x] Deploy TTTMP: npm run deploy — Success, 27 pages
- [x] Deploy DVLP: wrangler pages deploy — Success, 47 files
- [x] Deploy GVLP: wrangler pages deploy — Success, 133 files
- [x] Deploy TCVLP: wrangler pages deploy — Success (migrating to Next.js)
- [x] Deploy WLVLP: wrangler pages deploy — Success, 505 files

Date completed: 2026-04-05

---

## PHASE B — Test revenue platforms (must pass before any emails send)

Open each checklist. Test every item in a real browser. Fix failures before moving on.

### B1 — VLP (virtuallaunch.pro)
Open: scale/vlp-testing-checklist.md

- [ ] All VLP tests pass
- [ ] Failures found and fixed: _______________

### B2 — TTMP (transcript.taxmonitor.pro)
Open: scale/ttmp-testing-checklist.md

- [ ] All TTMP tests pass
- [ ] Failures found and fixed: _______________

### B3 — TMP (taxmonitor.pro)
Open: scale/tmp-testing-checklist.md

- [ ] All TMP tests pass
- [ ] Failures found and fixed: _______________

Date completed: _______________

---

## PHASE C — Test ecosystem platforms (must pass for credibility)

### C1 — TTTMP (taxtools.taxmonitor.pro)
Open: scale/tttmp-testing-checklist.md
- [ ] All tests pass

### C2 — WLVLP (websitelotto.virtuallaunch.pro)
Open: scale/wlvlp-testing-checklist.md
- [ ] All tests pass

### C3 — DVLP (developers.virtuallaunch.pro)
Open: scale/dvlp-testing-checklist.md
- [ ] All tests pass

### C4 — GVLP (games.virtuallaunch.pro)
Open: scale/gvlp-testing-checklist.md
- [ ] All tests pass

### C5 — TCVLP (taxclaim.virtuallaunch.pro)
Open each of the 4 HTML pages in browser. Test Form 843 generation end to end.
- [ ] All pages load
- [ ] Form 843 generates a real PDF
- [ ] PDF downloads correctly

Date completed: _______________

---

## PHASE D — Set up Hunter.io (do this once)

Open: scale/WORKFLOW.md — "First-Time Setup: Hunter.io" section

- [ ] Account created at hunter.io
- [ ] Gmail (Workspace) connected
- [ ] First campaign created: "VLP SCALE — Batch 1"
- [ ] Sending settings: 15/day, Mon-Fri, 9am-5pm
- [ ] Follow-up step added (3-day delay, if no reply)

Date completed: _______________

---

## PHASE E — First batch (VLP campaign)

### E1 — Source prospects
- [ ] Build Clay workbook (50 rows from FOIA/NAEA data)
- [ ] Export CSV from Clay
- [ ] Drop CSV in `C:\Users\eimaj\virtuallaunch.pro\scale\prospects\`

### E2 — Generate batch
```
cd C:\Users\eimaj\virtuallaunch.pro
node scale/generate-vlp-batch.js scale/prospects/{filename}.csv
```
- [ ] Generator ran without errors
- [ ] Prospects processed: _____
- [ ] Hunter CSV created at scale/hunter/vlp-email1-{date}.csv
- [ ] Spot-checked: no "undefined", signatures correct, links correct

### E3 — Push asset pages
```
node scale/push-vlp-asset-pages.js scale/batches/vlp-batch-{date}.json --exec
```
- [ ] Asset pages pushed to R2
- [ ] Spot-checked one asset page in browser: https://virtuallaunch.pro/asset/{slug}

### E4 — Send test email
- [ ] Imported CSV to Hunter campaign
- [ ] Added YOUR email as a test recipient
- [ ] Sent test email to yourself
- [ ] Email arrived in inbox (not spam)
- [ ] Subject line personalized
- [ ] Asset page link works
- [ ] Pricing link works
- [ ] TTMP cross-sell link works
- [ ] Signature shows Jamie L Williams

### E5 — Launch
- [ ] Removed test recipient (your email)
- [ ] Started campaign in Hunter
- [ ] Hunter is sending at 15/day

Date launched: _______________

---

## PHASE F — First batch (TTMP campaign) — start after VLP is sending

### F1 — Source prospects
- [ ] Build new Clay workbook (different segment from VLP batch)
- [ ] Export CSV
- [ ] Drop in `C:\Users\eimaj\transcript.taxmonitor.pro\scale\prospects\`

### F2 — Generate batch
```
cd C:\Users\eimaj\transcript.taxmonitor.pro
node scale/generate-batch.js scale/prospects/{filename}.csv
```
- [ ] Generator ran without errors
- [ ] Hunter CSV created

### F3 — Create separate Hunter campaign
- [ ] New campaign: "TTMP SCALE — Batch 1"
- [ ] Settings: 15/day, Mon-Fri, 9am-5pm

### F4 — Send test + launch
- [ ] Test email to yourself
- [ ] Looks good
- [ ] Campaign started

Date launched: _______________

---

## PHASE G — Daily operations (start the day after first send)

Do this every morning. Takes 15 minutes.

Open: scale/WORKFLOW.md — "Daily Operations" section

1. Check Hunter.io: opens, replies, bounces
2. Check Stripe: new subscriptions or purchases
3. Check email: prospect replies
4. Respond to any replies within 24 hours

---

## PHASE H — Weekly review (every Friday)

Open: scale/WORKFLOW.md — "Weekly Operations" section

- [ ] Week ___: Sent ___, Opened ___, Replied ___, Converted ___
- [ ] Week ___: Sent ___, Opened ___, Replied ___, Converted ___
- [ ] Week ___: Sent ___, Opened ___, Replied ___, Converted ___
- [ ] Week ___: Sent ___, Opened ___, Replied ___, Converted ___

### Warmup schedule (adjust Hunter daily limit)

| Week | Daily limit | Cumulative sent |
|------|------------|-----------------|
| 1 | 15 | ~75 |
| 2 | 25 | ~200 |
| 3 | 40 | ~400 |
| 4+ | 50 | ~650 |

After week 4: if bounce rate < 3% and no spam complaints, increase to 75-100/day.

### Pipeline health
- Prospects remaining in VLP source CSV: _____
- Prospects remaining in TTMP source CSV: _____
- Need new Clay workbook? [ ] yes [ ] no

---

## PHASE I — Monthly assessment

### Month 1
- Total emails sent (VLP + TTMP): _____
- VLP membership signups: _____
- TTMP token pack purchases: _____
- Total revenue: $_____
- Total cost: $100 (Claude) + $0 (Hunter free) = $100
- Profitable? [ ] yes [ ] no

### Month 2
- Cumulative revenue: $_____
- Consider Hunter upgrade ($49/mo)? [ ] yes — if > 500 recipients needed [ ] no
- New Clay workbooks built this month: _____
- SEO traffic to TTMP resource pages: _____ visits
- TMP directory visits: _____

### Month 3
- Cumulative revenue: $_____
- Total paying customers: _____
- Revenue > cost for 3 consecutive months? [ ] yes [ ] no

If yes: scale up — upgrade Hunter, increase batch size, start TTTMP campaign
If no: evaluate — is copy wrong? audience wrong? product wrong? Test changes.

---

## Reference files

| File | What it's for | Open when |
|------|--------------|-----------|
| scale/WORKFLOW.md | Hunter.io setup + daily ops detail | Phase D and G |
| scale/GLOBAL-TESTING-ORDER.md | Testing sequence | Phase B and C |
| scale/vlp-testing-checklist.md | VLP test items | Phase B1 |
| scale/ttmp-testing-checklist.md | TTMP test items | Phase B2 |
| scale/tmp-testing-checklist.md | TMP test items | Phase B3 |
| scale/tttmp-testing-checklist.md | TTTMP test items | Phase C1 |
| scale/wlvlp-testing-checklist.md | WLVLP test items | Phase C2 |
| scale/dvlp-testing-checklist.md | DVLP test items | Phase C3 |
| scale/gvlp-testing-checklist.md | GVLP test items | Phase C4 |
