# VLP SCALE — Manual Testing Checklist

Phase 5: Test full workflow end to end
Date: _____Sun, 4/5/2026 (Started)__________
Tester: Jamie L Williams

---

## Test 1 — Batch generator

Command: `node scale/generate-vlp-batch.js scale/prospects/{source}.csv`

- [X] Script runs without errors
- [X] Output reports "Prospects processed: X"
- [X] Batch JSON exists at scale/batches/vlp-batch-{date}.json
- [X] Hunter CSV exists at scale/hunter/vlp-email1-{date}.csv
- [X] Open Hunter CSV in text editor — all rows have valid email addresses
- [X] No row contains "undefined" anywhere
- [X] Every email body contains "Jamie L Williams" signature
- [X] Subject lines are personalized (name + firm or city)
- [X] Source CSV has vlp_email_1_prepared_at timestamps on processed rows
- [X] No prospect already in TTMP pipeline was included (email_1_prepared_at was empty for all)

Prospects processed: __See file___
File paths confirmed: __Sun, 4/5/2026___

---

## Test 2 — Push asset pages to R2

Command: `node scale/push-vlp-asset-pages.js scale/batches/vlp-batch-{date}.json --exec`

- [X] Script reports number of pages pushed
- [X] No errors during push
- [X] Verify at least one page exists in R2: `wrangler r2 object get virtuallaunch-pro/vlp-scale/asset-pages/{slug}.json`

Pages pushed: __Sun, 4/5/2026___

---

## Test 3 — Asset page loads in browser

URL: `https://virtuallaunch.pro/asset/{slug}`

- [X] Page loads (not 404)
- [X] Headline shows prospect's name and city
- [X] Subheadline shows correct credential label
- [X] Gap analysis section shows 3 items
- [X] Value estimate section shows dollar range
- [X] Tier comparison shows Active ($79) / Featured ($199) / Premier ($399)
- [X] Featured tier is highlighted as recommended
- [X] "See all membership tiers" links to virtuallaunch.pro/pricing — link works
- [X] TTMP cross-sell section appears with "10 analyses for $19"
- [X] TTMP link goes to transcript.taxmonitor.pro/pricing — link works
- [X] Directory link goes to taxmonitor.pro/directory — link works
- [X] Page renders correctly on mobile (375px width)

Slug tested: __Mon, 4/6/2026___
Screenshot taken: [ ] yes [X] no

---

## Test 4 — Pricing page

URL: `https://virtuallaunch.pro/pricing`

- [X] Page loads
- [X] Listed (Free) tier shows: $0, no tokens, basic features
- [X] Active tier shows: $79/mo, 2 transcript + 5 game tokens
- [X] Featured tier shows: $199/mo, 5 transcript + 15 game tokens
- [X] Premier tier shows: $399/mo, 10 transcript + 40 game tokens
- [X] Monthly/yearly toggle works (if present)
- [X] Click "Subscribe" on Active tier → redirects to Stripe Checkout
- [X] Stripe shows correct amount ($79.00)
- [X] Cancel out of Stripe → returns to VLP site
- [X] Page renders correctly on mobile

---

## Test 5 — TMP directory

URL: `https://taxmonitor.pro/directory`

- [X] Page loads with sample profiles visible
- [X] Count: 12 profiles displayed
- [X] Specialty filter: select "Enrolled Agent" → shows 4 profiles
- [X] Specialty filter: select "CPA" → shows 5 profiles
- [X] City filter: type a city → results narrow
- [X] Clear All → all 12 profiles return
- [X] Click a profile card → full profile page loads
- [X] Profile page shows: hero, credentials, bio, services, reviews
- [X] Profile page has booking/contact CTAs
- [X] Back to Directory link works
- [X] Page renders correctly on mobile

---

## Test 6 — Hunter.io import

- [X] Hunter.io account created
- [X] Gmail connected to Hunter
- [X] New sequence created
- [X] Upload scale/hunter/vlp-email1-{date}.csv
- [X] Hunter parses all columns: email, first_name, last_name, company, subject, body
- [X] Preview an email in Hunter — body looks correct with line breaks
- [X] No formatting issues in preview

---

## Test 7 — Send test email to self

- [X] Add a row to Hunter sequence with YOUR email address
- [X] Send single test email
- [X] Email arrives in inbox (not spam)
- [X] Subject line is personalized
- [X] Body has proper line breaks and formatting
- [X] Asset page link is clickable and works
- [X] Pricing page link works
- [X] TTMP link works
- [X] Signature shows Jamie L Williams

---

## Test 8 — Checkout success (optional but recommended)

- [ ] Complete a real Stripe Checkout in test mode
- [ ] Redirect to /checkout/success
- [ ] Success page shows welcome message
- [ ] Check Stripe dashboard — subscription created
- [ ] Check R2 — membership record exists
- [ ] Check D1 — token balance shows correct allocation

---

## Results Summary

| Test | Pass | Fail | Notes |
|------|------|------|-------|
| 1. Batch generator | | | |
| 2. R2 push | | | |
| 3. Asset page | | | |
| 4. Pricing page | | | |
| 5. TMP directory | | | |
| 6. Hunter import | | | |
| 7. Self-test email | | | |
| 8. Checkout | | | |

## Decision

- [ ] ALL TESTS PASS — ready to send first real batch
- [ ] FIXES NEEDED — list issues below

Issues found:
1. _______________
2. _______________
3. _______________

## First send date: _______Mon, 4/6/2026 (Hunter.io)________
