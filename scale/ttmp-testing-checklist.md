# TTMP — Testing Checklist

Platform: transcript.taxmonitor.pro
Date: ______Mon, 4/6/2026 (Started)_________
Tester: Jamie L Williams

---

## Test 1 — Landing page

URL: https://transcript.taxmonitor.pro

- [X] Page loads
- [X] Hero communicates "IRS transcript PDF → plain-English report"
- [X] Pricing is visible (10/$19, 25/$29, 100/$129)
- [X] CTA links work (pricing, demo, signup)
- [X] Mobile responsive

---

## Test 2 — Resource pages (spot check 5)

Check one of each template type:

IRS code page: https://transcript.taxmonitor.pro/resources/irs-code-971-meaning
- [X] Page loads with content
- [X] IRS code explanation is accurate
- [X] Taxpayer CTA appears ("Need help? Find a tax professional" → taxmonitor.pro/directory)
- [X] TTMP product CTA appears ("Try transcript analysis")
- [X] Both CTAs have working links

Explainer page: https://transcript.taxmonitor.pro/resources/account-transcript-explained
- [X] Page loads
- [X] Taxpayer CTA present with working link
- [X] Product CTA present

Comparison page: https://transcript.taxmonitor.pro/resources/canopy-vs-manual-transcript-interpretation
- [X] Page loads
- [X] Both CTAs present

How-to page: https://transcript.taxmonitor.pro/resources/how-to-read-irs-transcripts
- [X] Page loads
- [X] Both CTAs present

Sales page: (pick any from resources with "selling" or "pricing" in title)
- [X] Page loads
- [X] Both CTAs present

---

## Test 3 — Transcript parser tool

- [X] Navigate to the parser/parse lab
- [X] Can upload a test PDF (if you have a sample transcript)
- [X] Parser returns results with transaction codes
- [X] Codes link to resource pages

---

## Test 4 — Pricing page

URL: https://transcript.taxmonitor.pro/pricing (or equivalent)

- [X] Shows 3 token packs: 10/$19, 25/$29, 100/$129
- [X] Buy button goes to Stripe checkout
- [X] Stripe shows correct amount
- [X] Cancel returns to TTMP site

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
- [X] Landing page readable
- [X] Resource page readable
- [X] Both CTAs visible and tappable
- [X] Pricing page readable

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
1. ___https://transcript.taxmonitor.pro/resources/irs-code-971-meaning: 1) Improve the look of this CTA section: View sample report Try the parser (requires credits), 2)  All the links goes to *.html, for example, https://transcript.taxmonitor.pro/resources/how-to-read-irs-transcripts.html instead of https://transcript.taxmonitor.pro/resources/how-to-read-irs-transcripts/, 3) CTA "Transcript Analysis Tool →" goes to the wrong destination, https://transcript.taxmonitor.pro/demo/ (delete the demo page), should be https://transcript.taxmonitor.pro/, 4) Try the parser (requires credits) and View sample report#how-it-works goes to the wrong destionation, https://transcript.taxmonitor.pro/demo/, should go to: parser and sample report, 5) In the RELATED CODES right side panel, "irs" should be capitalized "IRS", 6) Book a demo goes to the wrong destination, https://transcript.taxmonitor.pro/demo/, should go to https://transcript.taxmonitor.pro/contact/, 7) Start Free Trial → should go to https://transcript.taxmonitor.pro/login/
2. __https://transcript.taxmonitor.pro/resources/account-transcript-explained: 1) Same as issue 1. above item 7_____________
3. __https://transcript.taxmonitor.pro/resources/canopy-vs-manual-transcript-interpretation: 1) Same as issue 1. above item 7, 2) Improve the content quality and add a comparison table with several comparable online tools (source from the original html file, if available)_____________
4. __https://transcript.taxmonitor.pro/resources/how-to-read-irs-transcripts/:  1) Same as issue 1. above item 7, 2) Improve the content quality (source from the original html file, if available), 3) Change the line above the Automate This Process section and in the CTA of the same section from orange to should match the color theme of the site_______________
