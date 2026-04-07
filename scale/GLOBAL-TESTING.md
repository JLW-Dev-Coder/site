# Global Testing Order

Work through each platform in this order. Do not skip ahead.
Fix issues as you find them before moving to the next platform.

---

## Round 1 — Revenue platforms (must work before first email)

### 1. VLP (virtuallaunch.pro)
Checklist: scale/vlp-testing-checklist.md
Priority: Highest — this is what prospects buy
Key tests: pricing page, checkout flow, asset pages, subscription webhook

### 2. TTMP (transcript.taxmonitor.pro)
Checklist: scale/ttmp-testing-checklist.md
Priority: High — cross-sell in every VLP email
Key tests: resource pages + CTAs, parser tool, pricing, token purchase

### 3. TMP (taxmonitor.pro)
Checklist: scale/tmp-testing-checklist.md
Priority: High — directory is the VLP value prop
Key tests: directory + filters, profile pages, intake flow, membership pricing

---

## Round 2 — Ecosystem platforms (must work for credibility)

### 4. TTTMP (taxtools.taxmonitor.pro)
Checklist: scale/tttmp-testing-checklist.md
Priority: Medium — tokens included in VLP tiers
Key tests: games library, game detail pages, token purchase, CTA banner

### 5. WLVLP (websitelotto.virtuallaunch.pro)
Checklist: scale/wlvlp-testing-checklist.md
Priority: Medium — visible in ecosystem
Key tests: template pages, sitemap, metadata, CTA banners

### 6. DVLP (developers.virtuallaunch.pro)
Checklist: scale/dvlp-testing-checklist.md
Priority: Low — $2.99 tier, different audience
Key tests: developer directory, find-developers form, pricing, support

### 7. GVLP (games.virtuallaunch.pro)
Checklist: scale/gvlp-testing-checklist.md
Priority: Low — B2B embed product
Key tests: landing page, games page, pricing, CTA banner

---

## Round 3 — TCVLP

### 8. TCVLP (taxclaim.virtuallaunch.pro)
Status: Migrated to Next.js, Form 843 generation functional
Test in browser:
- [ ] Homepage loads with hero, how-it-works, reviews, pricing
- [ ] /demo loads (requires auth)
- [ ] /sign-in loads, magic link works
- [ ] /what-is-form-843 loads (SEO content page)
- [ ] Form 843 generation produces a PDF
- [ ] PDF downloads correctly
- [ ] CtaBanner appears on all pages (Form 843 + TMP directory)
- [ ] Mobile responsive

---

## How to work through this

1. Open the checklist for the current platform
2. Test each item in order
3. Mark pass or fail
4. If fail: note the issue, open a Claude chat, get a fix prompt
5. Re-test the failed item after the fix
6. When all items pass, move to next platform
7. After Round 1 completes: VLP SCALE campaign can launch

---

## Issues Found

Status: Open — collected from Round 1 testing (2026-04-06)

### VLP

1. _____https://virtuallaunch.pro/dashboard: 1) Fix the SVGs, they are distorted on the page, 2) Profile Setup (re-name Directory Profile), 3) For Receipts, re-name/re-package as Payouts or Payments (for 12% platform fee x $/mo pre-payment paid out to tax pro who self-assigned clients from the pool and complete the post-payment flow)
2. _____https://virtuallaunch.pro/analytics: 1) When clicking the first Cal.com connect link, the page directs to here (https://app.cal.com/oauth2/authorize?client_id=782133b560b9ee33174a7a765b8cd73343ffeb2ece517be73a3061f370e21eeb&redirect_uri=https%3A%2F%2Fapi.virtuallaunch.pro%2Fcal%2Fapp%2Foauth%2Fcallback&response_type=code&state=eyJhY2NvdW50SWQiOiJBQ0NUXzIzNmE4YjM5LTM3MzgtNDQ2NS05YjViLWNjMTZkZWZjYWU1MSIsIm5vbmNlIjoiOTQwNGMzMzItYTFjZi00ZjcwLWJiMDAtNmY0NjJhYTcxODgzIiwiZmxvdyI6InZscCJ9&code_challenge=Vwdg0uIDlne2cEST36fPkBryC7xMNqdN-KejVefL0pw&code_challenge_method=S256) and shows 404 error, 2) When clicking the first Cal.com connect link, the page directs to here (https://app.cal.com/oauth2/authorize?client_id=9d03bcaa8ee24644d21dc7af5c3c17722ffa314c9790f2c7c83a1f88032b8420&redirect_uri=https%3A%2F%2Fapi.virtuallaunch.pro%2Fv1%2Fcal%2Foauth%2Fcallback&response_type=code)
3. _____https://virtuallaunch.pro/onboarding (profile setup): 1) Behavior should be: first signin, the profile setup page opens as an onboarding step (no sidebar or topbar should show) but allows use to  skip onboarding. On subsequent sign-ins, the user can self-select the profile setup page on the sidebar, at which time the skip button should not show. 2) Step 5 of onboarding, normalize the phone number, 3) If any required area is skipped, the user should be directed to that step, for example, professionalId and displayName required, 4) Once submitted, user should be directed to the directory where their name should be auto-entered and their profile displayed for their review, 5) Make the directory page available as a button so profile can be viewed life at any time, 6) Could we provide a profile link? If so, implement a share my link so they can see the link and share it button on the page
4. _____https://virtuallaunch.pro/account: 1) There should be 4 plan cards. Make the look like the https://virtuallaunch.pro/pricing cards. The plan that the user is current only should be selected, with upgrade or downgrade buttons based on their current plan (the checkout currently work fine)
5. ____https://virtuallaunch.pro/affiliate: 1) Page does not load, shows error: Application error: a server-side exception has occurred while loading virtuallaunch.pro (see the server logs for more information). [FIXED 2026-04-06]
Digest: 2486881340
6. ____https://virtuallaunch.pro/receipts: 1) Still need to text with a test or live receipt
7. ____https://virtuallaunch.pro/token-usage: 1) Not showing usage history although tokens have been used [FIXED 2026-04-06]
8. ____https://virtuallaunch.pro/messaging (inquiries): 1) Still need to text with a test or live receipt
9. ____https://virtuallaunch.pro/scale: 1) Create a operator-only dashboard, separate from the member dashboard. Sidebar menu items: Analytics - All 8 Sites with all the page analytics available with CloudFlare API, Support - Ability to view and response to support tickets, Calendar - Overview of cancelled/booked/rescheduled books with a list of bookings with details viewable as a pop-up on click. CRM - A list of clients filterable by platform (It would be nice if there was a summary card that I can click for each repo that opens that list of clients and a All Clients list for that includes all clients from all repos. Each client can be clicked that will show the details of that clients along with emails sent/replied/clicks/affiliate stats/books/purchases), Sales - Overview and list of purchases per repo/sites, allow user to click to go to that CRM client's purchase details. Topbar menu will have the only shared menu item: Profile (icon)
10. ___https://virtuallaunch.pro/support: 1) Instead of the pop-up ticket form, allow the message to be entered as a form on the page

### TMP

1. ____https://taxmonitor.pro/directory: 1) Instead of entry fields make city and state dropdowns.
2. ____https://taxmonitor.pro/pricing; 1) For the monthly and yearly toggle, I want them to look like this https://virtuallaunch.pro/pricing page's toggle, 2) For each price, monthly or yearly, all should open a Stripe checkout. Now, they do not, they just refresh the page. [FIXED 2026-04-06 — Worker /v1/tmp/memberships/checkout response was returned without the request arg, so getCorsHeaders fell back to virtuallaunch.pro and browser blocked the cross-origin response from taxmonitor.pro. Added request arg to json() at workers/src/index.js:7452 (and to membership/preferences/dashboard handlers that had the same omission). TMP pricing page now also surfaces checkout errors via alert instead of swallowing them.]
3. ____https://taxmonitor.pro/sign-in: 1) For the magic link, it directs to the wrong destination: https://taxmonitor.pro/sign-in?redirect=%2Fdashboard
4. ____https://taxmonitor.pro/dashboard: 1) The tax pro-specific dashboard is incorrectly nested inside the taxpayer/public dashboard, there should only the taxpayer dashboard, the tax pro-specific dashboard should only be avaiable through VLP, 2) Token Balance prints "NaN" versus 0 or the actual amount [FIXED 2026-04-06 — DashboardHome was reading res.transcript_tokens + res.tax_game_tokens from /v1/tokens/balance, but the worker returns {balance:{transcriptTokens, taxGameTokens}} (camelCase, nested), so both were undefined → undefined+undefined = NaN. Switched to reading session.transcript_tokens from /v1/auth/session per the canonical session shape.]
5. ____https://taxmonitor.pro/dashboard/profile: 1) Fix the error: Failed to load, try again [FIXED 2026-04-06 — ProfileContent was using Promise.all over getAccount/getPreferences/get2faStatus and reading them as flat objects. The worker returns {ok, account:{...}} and {ok, preferences:{...}}; preferences default branch was also missing the request arg in json() so its CORS header fell back and the browser rejected the response, failing the whole Promise.all. Switched to Promise.allSettled, unwrapped .account and .preferences, mapped in_app_enabled/sms_enabled/appearance correctly, and added the request arg to the worker's preferences default response (workers/src/index.js:7608).]
6. ____https://taxmonitor.pro/calendar: 1) Remove and use hardcoded calendar entries. Add them to a contract that includes a cron schedule based on their membership level (i.e. 6/wk, 8/wk, 12/wk, or one-time, MFJ is an add-on to any plan) 2) For Cal.com integration, when clicking Connect Calendar, fix the error, right now it shows page https://api.taxmonitor.pro/v1/cal/oauth/start and JSON body {"ok":true,"status":"redirect_required","authorizationUrl":"https://app.cal.com/oauth2/authorize?client_id=782133b560b9ee33174a7a765b8cd73343ffeb2ece517be73a3061f370e21eeb&redirect_uri=https%3A%2F%2Fapi.virtuallaunch.pro%2Fcal%2Fapp%2Foauth%2Fcallback&response_type=code&state=eyJhY2NvdW50SWQiOiJBQ0NUXzIzNmE4YjM5LTM3MzgtNDQ2NS05YjViLWNjMTZkZWZjYWU1MSIsIm5vbmNlIjoiNGZiMGI4NWQtY2JkNS00NDEwLWE2NDAtZDQwMjFjNjY3NDZiIiwiZmxvdyI6InZscCJ9&code_challenge=3VbQJEOUHug6SvuINmfVqgYkD6tvDdZdi_verplNXH8&code_challenge_method=S256"}. It should redirect back to the app calendar page and show the Cal.com events on the calendar, 3) Both Cal.com event types never resolve (tax-monitor-pro/tax-monitor-service-intro and tax-monitor-pro/tax-monitor-service-support, use the pop-up element embeds below), 4) For the calendar date cards, they all should be the same size. Right now, they render uneven widths but same height
7. ____https://taxmonitor.pro/messages: 1) Instead of the  pop-up message form, allow the message to be entered as a form on the page
8. ____https://taxmonitor.pro/support: 1) Directs user to https://transcript.taxmonitor.pro/login/ when instead there should be a fully functional supported page designed with a support ticket form (use the https://virtuallaunch.pro/support page as reference for the design, also note I was able to test a ticket submission and it was received), 2) Instead of the pop-up ticket form, allow the message to be entered as a form on the page
9. ____https://taxmonitor.pro/exit-survey: 1) Instead of the pop-up thank you, show the thank you message on the page
10. ____https://taxmonitor.pro/intake: 1) At Step 3, normalize the phone number after it is entered, 2) At Step 3, I am unable to click the Back and I should be able to (ensure we have this behavior for all steps) 
11. ____https://taxmonitor.pro/payment: 1) At the payment page, the offer that was selected should show. Now, it blank
12. ____https://taxmonitor.pro/payment-success: Unable to test, see issue 11. 

### TTMP

1. ___https://transcript.taxmonitor.pro/resources/irs-code-971-meaning: 1) Improve the look of this CTA section: View sample report Try the parser (requires credits), 2)  All the links goes to *.html, for example, https://transcript.taxmonitor.pro/resources/how-to-read-irs-transcripts.html instead of https://transcript.taxmonitor.pro/resources/how-to-read-irs-transcripts/, 3) CTA "Transcript Analysis Tool →" goes to the wrong destination, https://transcript.taxmonitor.pro/demo/ (delete the demo page), should be https://transcript.taxmonitor.pro/, 4) Try the parser (requires credits) and View sample report#how-it-works goes to the wrong destionation, https://transcript.taxmonitor.pro/demo/, should go to: parser and sample report, 5) In the RELATED CODES right side panel, "irs" should be capitalized "IRS", 6) Book a demo goes to the wrong destination, https://transcript.taxmonitor.pro/demo/, should go to https://transcript.taxmonitor.pro/contact/, 7) Start Free Trial → should go to https://transcript.taxmonitor.pro/login/
2. ___https://transcript.taxmonitor.pro/resources/account-transcript-explained: 1) Same as issue 1. above item 7_____________
3. ___https://transcript.taxmonitor.pro/resources/canopy-vs-manual-transcript-interpretation: 1) Same as issue 1. above item 7, 2) Improve the content quality and add a comparison table with several comparable online tools (source from the original html file, if available)_____________
4. ___https://transcript.taxmonitor.pro/resources/how-to-read-irs-transcripts/:  1) Same as issue 1. above item 7, 2) Improve the content quality (source from the original html file, if available), 3) Change the line above the Automate This Process section and in the CTA of the same section from orange to should match the color theme of the site
5. ___https://transcript.taxmonitor.pro/app/dashboard/: 1) Email report link to client doesn't work as intended, prehaps we should remove this entirely (do as is best recommended) [FIXED 2026-04-06 — frontend was POSTing to /forms/transcript/report-email with payload {email,eventId,reportUrl,tokenId}; corrected to /v1/transcripts/report-email with {report_id,email,event_id} matching VLP Worker contract. Also stored data.report_id from /v1/transcripts/preview response and removed the 1.5s auto-redirect that was navigating away before users could use the email field.]
6. ___https://transcript.taxmonitor.pro/app/reports/: 1) No reports are loading although reports have been saved/printed to PDF [FIXED 2026-04-06 — page was a static "No reports yet" placeholder that never called the API. Wired it up to GET /v1/transcripts/reports (cookie auth) and render the list with Open links into /app/report/?report_id=...]
7. ___https://transcript.taxmonitor.pro/app/receipts/: 1) Still need to test with Stripe sandbox or using promotional coupons (100% discount)
8. ___https://transcript.taxmonitor.pro/app/support/: 1) Same as TMP
9. ___https://transcript.taxmonitor.pro/app/token-usage/: 1) Still need to test with Stripe sandbox or adding test tokens through R2
10. ___https://transcript.taxmonitor.pro/app/calendar/: 1) Same as TMP
11. ___https://transcript.taxmonitor.pro/app/affiliate/: 1) Laods in purple instad of teal/TTMP brand colors, also the sidebar for the affiliate is different then the others, ensure they are all in unison (use components, if best), and ensure mobile responsible (right now, in the mobile version, the sidebar takes up 1/2 of the screen when viewing the affiliate page and filles up the top of the mobile screen for the other pages)
12. For the app topbar, can we implement a modern look and use it across all repos for uniformity

### DVLP

1. ____https://developers.virtuallaunch.pro: 1) Add the 9 tech icons to the left side hero
2. ____https://developers.virtuallaunch.pro/developers: 1) Add the detailed filters like the original .html page
3. ____https://developers.virtuallaunch.pro/find-developers: 1) Change the CTA Find a Developer to direct to https://developers.virtuallaunch.pro/developers instead of itself, 2) For the form, normalize the phone number and allow multi-project type selections
4. ____https://developers.virtuallaunch.pro/onboarding: 1) For step 1 of the form, normalize the phone number, add dropdown behavior for the city and country (make both required fields), 2) For step 2, we want experience level per tech item (adjust the behavior accordingly - the contract should reflect the experience level per tech item), 3) For all fields, add a tooltip to each, 4) When click step 4, this error shows: Something went wrong. Please try again so I could not test the success page or loadiing the support reference ID
5. ____https://developers.virtuallaunch.pro/support: 1) The page should include a support ticket form, where the user can enter their reference ID (emailed upon submission and printed/rendered on the success page) to view their support ticket status or to load their job matches and messages (see https://virtuallaunch.pro/contact to use as a  reference for the full support page layout and design), 2) The book call card should open the following Cal.com event via pop-up element on click, 3) The hero and CTA button reference to book call should direct the user to the book call card.
