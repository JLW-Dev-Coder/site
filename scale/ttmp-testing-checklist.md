# TTMP — Testing Checklist

Platform: transcript.taxmonitor.pro
Date: _______________
Tester: Jamie L Williams

---

## Test 1 — Landing page

URL: https://transcript.taxmonitor.pro

- [ ] Page loads
- [ ] Hero communicates "IRS transcript PDF → plain-English report"
- [ ] Pricing is visible (10/$19, 25/$29, 100/$129)
- [ ] CTA links work (pricing, demo, signup)
- [ ] Mobile responsive

---

## Test 2 — Resource pages (spot check 5)

Check one of each template type:

IRS code page: https://transcript.taxmonitor.pro/resources/irs-code-971-meaning
- [ ] Page loads with content
- [ ] IRS code explanation is accurate
- [ ] Taxpayer CTA appears ("Need help? Find a tax professional" → taxmonitor.pro/directory)
- [ ] TTMP product CTA appears ("Try transcript analysis")
- [ ] Both CTAs have working links

Explainer page: https://transcript.taxmonitor.pro/resources/account-transcript-explained
- [ ] Page loads
- [ ] Taxpayer CTA present with working link
- [ ] Product CTA present

Comparison page: https://transcript.taxmonitor.pro/resources/canopy-vs-manual-transcript-interpretation
- [ ] Page loads
- [ ] Both CTAs present

How-to page: https://transcript.taxmonitor.pro/resources/how-to-read-irs-transcripts
- [ ] Page loads
- [ ] Both CTAs present

Sales page: (pick any from resources with "selling" or "pricing" in title)
- [ ] Page loads
- [ ] Both CTAs present

---

## Test 3 — Transcript parser tool

- [ ] Navigate to the parser/parse lab
- [ ] Can upload a test PDF (if you have a sample transcript)
- [ ] Parser returns results with transaction codes
- [ ] Codes link to resource pages

---

## Test 4 — Pricing page

URL: https://transcript.taxmonitor.pro/pricing (or equivalent)

- [ ] Shows 3 token packs: 10/$19, 25/$29, 100/$129
- [ ] Buy button goes to Stripe checkout
- [ ] Stripe shows correct amount
- [ ] Cancel returns to TTMP site

---

## Test 5 — Auth flow

- [ ] Sign-in page loads
- [ ] Magic link request works (sends email)
- [ ] Google OAuth button works
- [ ] After login, lands on dashboard
- [ ] Dashboard shows token balance

---

## Test 6 — App pages (authenticated)

- [ ] Dashboard loads with real data or empty state
- [ ] Reports page loads
- [ ] Token usage page loads
- [ ] Account page loads
- [ ] Support page loads

---

## Test 7 — Mobile spot check

Open on phone or 375px browser:
- [ ] Landing page readable
- [ ] Resource page readable
- [ ] Both CTAs visible and tappable
- [ ] Pricing page readable

---

## Results

| Test | Pass | Fail | Notes |
|------|------|------|-------|
| 1. Landing | | | |
| 2. Resources | | | |
| 3. Parser | | | |
| 4. Pricing | | | |
| 5. Auth | | | |
| 6. App pages | | | |
| 7. Mobile | | | |

Issues found:
1. _______________
2. _______________
