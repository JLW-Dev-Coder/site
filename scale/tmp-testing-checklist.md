# TMP — Testing Checklist

Platform: taxmonitor.pro
Date: _______________
Tester: Jamie L Williams

---

## Test 1 — Landing page

URL: https://taxmonitor.pro

- [ ] Page loads
- [ ] Hero targets taxpayers ("Find the right tax professional")
- [ ] Membership CTA section shows 3 tiers: Essential ($9), Plus ($19), Premier ($39)
- [ ] Plus tier has "Most Popular" badge
- [ ] All tier CTAs link to /pricing
- [ ] Mobile responsive

---

## Test 2 — Directory

URL: https://taxmonitor.pro/directory

- [ ] Page loads with 12 sample profiles
- [ ] Specialty filter: "Enrolled Agent" → 4 profiles
- [ ] Specialty filter: "CPA" → 5 profiles
- [ ] Specialty filter: "Attorney" → 3 profiles
- [ ] Specialty filter: "ERPA" → 1 profile
- [ ] Specialty filter: "Enrolled Actuary" → 1 profile
- [ ] City filter narrows results
- [ ] State filter narrows results
- [ ] Clear All resets
- [ ] Click profile card → profile page loads

---

## Test 3 — Profile page

Pick any profile from directory:

- [ ] Hero with name, credentials, location
- [ ] Bio section
- [ ] Services section
- [ ] Specializations
- [ ] Reviews with star ratings
- [ ] Contact/booking CTAs
- [ ] Back to Directory link works
- [ ] Mobile responsive

---

## Test 4 — Pricing page

URL: https://taxmonitor.pro/pricing

- [ ] TMP membership tiers displayed
- [ ] Service plans displayed (Bronze/Silver/Gold/Snapshot)
- [ ] Checkout buttons work → Stripe
- [ ] Correct amounts in Stripe

---

## Test 5 — Intake flow

- [ ] /inquiry → 12-question form loads, submits
- [ ] /intake → 3-step wizard loads
- [ ] /offer → plan selection (Bronze/Silver/Gold/Snapshot)
- [ ] /agreement → service agreement with checkbox
- [ ] /payment → Stripe checkout
- [ ] /payment-success → confirmation page

---

## Test 6 — Auth flow

- [ ] /sign-in loads
- [ ] Magic link works
- [ ] Google OAuth works
- [ ] Redirects to dashboard after login

---

## Test 7 — App pages (authenticated)

- [ ] Dashboard loads with views
- [ ] Profile editor works
- [ ] Calendar loads (Cal.com integration)
- [ ] Messages loads (inbox, compose)
- [ ] Support page loads with FAQ + ticket form

---

## Test 8 — Exit survey

URL: https://taxmonitor.pro/exit-survey

- [ ] Page loads with all 7 questions
- [ ] Submit shows thank you message

---

## Test 9 — Legal pages

- [ ] /legal/privacy loads
- [ ] /legal/terms loads
- [ ] /legal/refund loads

---

## Test 10 — Mobile spot check

- [ ] Landing page
- [ ] Directory + filters
- [ ] Profile page
- [ ] Pricing page

---

## Results

| Test | Pass | Fail | Notes |
|------|------|------|-------|
| 1. Landing | | | |
| 2. Directory | | | |
| 3. Profile | | | |
| 4. Pricing | | | |
| 5. Intake | | | |
| 6. Auth | | | |
| 7. App pages | | | |
| 8. Exit survey | | | |
| 9. Legal | | | |
| 10. Mobile | | | |

Issues found:
1. _______________
2. _______________
