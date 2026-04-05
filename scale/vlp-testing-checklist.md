# VLP SCALE — Manual Testing Checklist

Phase 5: Test full workflow end to end
Date: _______________
Tester: Jamie L Williams

---

## Test 1 — Batch generator

Command: `node scale/generate-vlp-batch.js scale/prospects/{source}.csv`

- [ ] Script runs without errors
- [ ] Output reports "Prospects processed: X"
- [ ] Batch JSON exists at scale/batches/vlp-batch-{date}.json
- [ ] Hunter CSV exists at scale/hunter/vlp-email1-{date}.csv
- [ ] Open Hunter CSV in text editor — all rows have valid email addresses
- [ ] No row contains "undefined" anywhere
- [ ] Every email body contains "Jamie L Williams" signature
- [ ] Subject lines are personalized (name + firm or city)
- [ ] Source CSV has vlp_email_1_prepared_at timestamps on processed rows
- [ ] No prospect already in TTMP pipeline was included (email_1_prepared_at was empty for all)

Prospects processed: _____
File paths confirmed: _____

---

## Test 2 — Push asset pages to R2

Command: `node scale/push-vlp-asset-pages.js scale/batches/vlp-batch-{date}.json --exec`

- [ ] Script reports number of pages pushed
- [ ] No errors during push
- [ ] Verify at least one page exists in R2: `wrangler r2 object get virtuallaunch-pro/vlp-scale/asset-pages/{slug}.json`

Pages pushed: _____

---

## Test 3 — Asset page loads in browser

URL: `https://virtuallaunch.pro/asset/{slug}`

- [ ] Page loads (not 404)
- [ ] Headline shows prospect's name and city
- [ ] Subheadline shows correct credential label
- [ ] Gap analysis section shows 3 items
- [ ] Value estimate section shows dollar range
- [ ] Tier comparison shows Active ($79) / Featured ($199) / Premier ($399)
- [ ] Featured tier is highlighted as recommended
- [ ] "See all membership tiers" links to virtuallaunch.pro/pricing — link works
- [ ] TTMP cross-sell section appears with "10 analyses for $19"
- [ ] TTMP link goes to transcript.taxmonitor.pro/pricing — link works
- [ ] Directory link goes to taxmonitor.pro/directory — link works
- [ ] Page renders correctly on mobile (375px width)

Slug tested: _____
Screenshot taken: [ ] yes [ ] no

---

## Test 4 — Pricing page

URL: `https://virtuallaunch.pro/pricing`

- [ ] Page loads
- [ ] Listed (Free) tier shows: $0, no tokens, basic features
- [ ] Active tier shows: $79/mo, 2 transcript + 5 game tokens
- [ ] Featured tier shows: $199/mo, 5 transcript + 15 game tokens
- [ ] Premier tier shows: $399/mo, 10 transcript + 40 game tokens
- [ ] Monthly/yearly toggle works (if present)
- [ ] Click "Subscribe" on Active tier → redirects to Stripe Checkout
- [ ] Stripe shows correct amount ($79.00)
- [ ] Cancel out of Stripe → returns to VLP site
- [ ] Page renders correctly on mobile

---

## Test 5 — TMP directory

URL: `https://taxmonitor.pro/directory`

- [ ] Page loads with sample profiles visible
- [ ] Count: 12 profiles displayed
- [ ] Specialty filter: select "Enrolled Agent" → shows 4 profiles
- [ ] Specialty filter: select "CPA" → shows 5 profiles
- [ ] City filter: type a city → results narrow
- [ ] Clear All → all 12 profiles return
- [ ] Click a profile card → full profile page loads
- [ ] Profile page shows: hero, credentials, bio, services, reviews
- [ ] Profile page has booking/contact CTAs
- [ ] Back to Directory link works
- [ ] Page renders correctly on mobile

---

## Test 6 — Hunter.io import

- [ ] Hunter.io account created
- [ ] Gmail connected to Hunter
- [ ] New sequence created
- [ ] Upload scale/hunter/vlp-email1-{date}.csv
- [ ] Hunter parses all columns: email, first_name, last_name, company, subject, body
- [ ] Preview an email in Hunter — body looks correct with line breaks
- [ ] No formatting issues in preview

---

## Test 7 — Send test email to self

- [ ] Add a row to Hunter sequence with YOUR email address
- [ ] Send single test email
- [ ] Email arrives in inbox (not spam)
- [ ] Subject line is personalized
- [ ] Body has proper line breaks and formatting
- [ ] Asset page link is clickable and works
- [ ] Pricing page link works
- [ ] TTMP link works
- [ ] Signature shows Jamie L Williams

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

## First send date: _______________
