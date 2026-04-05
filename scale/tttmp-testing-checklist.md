# TTTMP — Testing Checklist

Platform: taxtools.taxmonitor.pro
Date: _______________
Tester: Jamie L Williams

---

## Test 1 — Landing page

URL: https://taxtools.taxmonitor.pro

- [ ] Page loads
- [ ] Value prop for tax education games
- [ ] Token pack pricing visible ($9/$19/$39)
- [ ] CTA links work

---

## Test 2 — Games library

URL: https://taxtools.taxmonitor.pro/games

- [ ] Page loads with all 11 games listed
- [ ] Each game shows name, description, token cost
- [ ] "Play" buttons visible

---

## Test 3 — Game detail pages (spot check 3)

Check 3 different game about pages:
- [ ] /about-games/irs-tax-detective loads with description
- [ ] /about-games/circular-230-quest loads
- [ ] /about-games/tax-deadline-master loads
- [ ] CTA banner appears on each (TMP directory + token upsell)
- [ ] CTA links work

---

## Test 4 — Pricing

URL: https://taxtools.taxmonitor.pro/pricing

- [ ] 3 token packs displayed (30/$9, 80/$19, 200/$39)
- [ ] Buy buttons go to Stripe checkout
- [ ] Correct amounts

---

## Test 5 — Auth flow

- [ ] Login page loads
- [ ] Magic link or Google OAuth works
- [ ] Redirects to account after login

---

## Test 6 — Account page (authenticated)

- [ ] Account page loads
- [ ] Shows token balance
- [ ] Shows membership info

---

## Test 7 — Legal pages

- [ ] /legal/privacy loads
- [ ] /legal/terms loads
- [ ] /legal/refund loads

---

## Test 8 — Mobile

- [ ] Landing page
- [ ] Games library
- [ ] Game detail page with CTA banner

---

## Results

| Test | Pass | Fail | Notes |
|------|------|------|-------|
| 1. Landing | | | |
| 2. Games library | | | |
| 3. Game details | | | |
| 4. Pricing | | | |
| 5. Auth | | | |
| 6. Account | | | |
| 7. Legal | | | |
| 8. Mobile | | | |

Issues found:
1. _______________
2. _______________
