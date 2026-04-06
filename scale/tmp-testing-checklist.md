# TMP — Testing Checklist

Platform: taxmonitor.pro
Date: ______Mon, 4/6/2026 (Started)_________
Tester: Jamie L Williams

---

## Test 1 — Landing page

URL: https://taxmonitor.pro

- [X] Page loads
- [X] Hero targets taxpayers ("Find the right tax professional")
- [X] Membership CTA section shows 3 tiers: Essential ($9), Plus ($19), Premier ($39)
- [X] Plus tier has "Most Popular" badge
- [X] All tier CTAs link to /pricing
- [X] Mobile responsive

---

## Test 2 — Directory

URL: https://taxmonitor.pro/directory

- [X] Page loads with 12 sample profiles
- [X] Specialty filter: "Enrolled Agent" → 4 profiles
- [X] Specialty filter: "CPA" → 5 profiles
- [X] Specialty filter: "Attorney" → 3 profiles
- [X] Specialty filter: "ERPA" → 1 profile
- [X] Specialty filter: "Enrolled Actuary" → 1 profile
- [X] City filter narrows results
- [X] State filter narrows results
- [X] Clear All resets
- [X] Click profile card → profile page loads

---

## Test 3 — Profile page

Pick any profile from directory:

- [X] Hero with name, credentials, location
- [X] Bio section
- [X] Services section
- [X] Specializations
- [X] Reviews with star ratings
- [X] Contact/booking CTAs
- [X] Back to Directory link works
- [X] Mobile responsive

---

## Test 4 — Pricing page

URL: https://taxmonitor.pro/pricing

- [X] TMP membership tiers displayed
- [X] Service plans displayed (Bronze/Silver/Gold/Snapshot)
- [X] Checkout buttons work → Stripe
- [X] Correct amounts in Stripe

---

## Test 5 — Intake flow

- [X] /inquiry → 12-question form loads, submits
- [X] /intake → 3-step wizard loads
- [X] /offer → plan selection (Bronze/Silver/Gold/Snapshot)
- [X] /agreement → service agreement with checkbox
- [X] /payment → Stripe checkout
- [X] /payment-success → confirmation page

---

## Test 6 — Auth flow

- [X] /sign-in loads
- [X] Magic link works
- [X] Google OAuth works
- [X] Redirects to dashboard after login

---

## Test 7 — App pages (authenticated)

- [X] Dashboard loads with views
- [X] Profile editor works
- [X] Calendar loads (Cal.com integration)
- [X] Messages loads (inbox, compose)
- [X] Support page loads with FAQ + ticket form

---

## Test 8 — Exit survey

URL: https://taxmonitor.pro/exit-survey

- [X] Page loads with all 7 questions
- [X] Submit shows thank you message

---

## Test 9 — Legal pages

- [X] /legal/privacy loads
- [X] /legal/terms loads
- [X] /legal/refund loads

---

## Test 10 — Mobile spot check

- [X] Landing page
- [X] Directory + filters
- [X] Profile page
- [X] Pricing page

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
1. ____https://taxmonitor.pro/directory: 1) Instead of entry fields make city and state dropdowns.
2. ____https://taxmonitor.pro/pricing; 1) For the monthly and yearly toggle, I want them to look like this https://virtuallaunch.pro/pricing page's toggle, 2) For each price, monthly or yearly, all should open a Stripe checkout. Now, they do not, they just refresh the page.
3. ____https://taxmonitor.pro/sign-in: 1) For the magic link, it directs to the wrong destination: https://taxmonitor.pro/sign-in?redirect=%2Fdashboard
4. ____https://taxmonitor.pro/dashboard: 1) The tax pro-specific dashboard is incorrectly nested inside the taxpayer/public dashboard, there should only the taxpayer dashboard, the tax pro-specific dashboard should only be avaiable through VLP
5. ____https://taxmonitor.pro/dashboard/profile: 1) Fix the error: Failed to load, try again
6. ____https://taxmonitor.pro/calendar: 1) Remove and use hardcoded calendar entries. Add them to a contract that includes a cron schedule based on their membership level (i.e. 6/wk, 8/wk, 12/wk, or one-time, MFJ is an add-on to any plan) 2) For Cal.com integration, when clicking Connect Calendar, fix the error, right now it shows page https://api.taxmonitor.pro/v1/cal/oauth/start and JSON body {"ok":true,"status":"redirect_required","authorizationUrl":"https://app.cal.com/oauth2/authorize?client_id=782133b560b9ee33174a7a765b8cd73343ffeb2ece517be73a3061f370e21eeb&redirect_uri=https%3A%2F%2Fapi.virtuallaunch.pro%2Fcal%2Fapp%2Foauth%2Fcallback&response_type=code&state=eyJhY2NvdW50SWQiOiJBQ0NUXzIzNmE4YjM5LTM3MzgtNDQ2NS05YjViLWNjMTZkZWZjYWU1MSIsIm5vbmNlIjoiNGZiMGI4NWQtY2JkNS00NDEwLWE2NDAtZDQwMjFjNjY3NDZiIiwiZmxvdyI6InZscCJ9&code_challenge=3VbQJEOUHug6SvuINmfVqgYkD6tvDdZdi_verplNXH8&code_challenge_method=S256"}. It should redirect back to the app calendar page and show the Cal.com events on the calendar, 3) Both Cal.com event types never resolve (tax-monitor-pro/tax-monitor-service-intro and tax-monitor-pro/tax-monitor-service-support, use the pop-up element embeds below), 4) For the calendar date cards, they all should be the same size. Right now, they render uneven widths but same height
7. ____https://taxmonitor.pro/messages: 1) Instead of the  pop-up message form, allow the message to be entered as a form on the page
8. ____https://taxmonitor.pro/support: 1) Directs user to https://transcript.taxmonitor.pro/login/ when instead there should be a fully functional supported page designed with a support ticket form (use the https://virtuallaunch.pro/support page as reference for the design, also note I was able to test a ticket submission and it was received), 2) Instead of the pop-up ticket form, allow the message to be entered as a form on the page
9. ____https://taxmonitor.pro/exit-survey: 1) Instead of the pop-up thank you, show the thank you message on the page
10. ____https://taxmonitor.pro/intake: 1) At Step 3, normalize the phone number after it is entered, 2) At Step 3, I am unable to click the Back and I should be able to (ensure we have this behavior for all steps) 
11. ____https://taxmonitor.pro/payment: 1) At the payment page, the offer that was selected should show. Now, it blank
12. ____https://taxmonitor.pro/payment-success: Unable to test, see issue 11. 

---
<!-- Cal element-click embed code begins -->
<script type="text/javascript">
  (function (C, A, L) { let p = function (a, ar) { a.q.push(ar); }; let d = C.document; C.Cal = C.Cal || function () { let cal = C.Cal; let ar = arguments; if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; } if (ar[0] === L) { const api = function () { p(api, arguments); }; const namespace = ar[1]; api.q = api.q || []; if(typeof namespace === "string"){cal.ns[namespace] = cal.ns[namespace] || api;p(cal.ns[namespace], ar);p(cal, ["initNamespace", namespace]);} else p(cal, ar); return;} p(cal, ar); }; })(window, "https://app.cal.com/embed/embed.js", "init");
Cal("init", "tax-monitor-service-support", {origin:"https://app.cal.com"});

  
  // Important: Please add the following attributes to the element that should trigger the calendar to open upon clicking.
  // `data-cal-link="tax-monitor-pro/tax-monitor-service-support"`
  // data-cal-namespace="tax-monitor-service-support"
  // `data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'`

  Cal.ns["tax-monitor-service-support"]("ui", {"cssVarsPerTheme":{"light":{"cal-brand":"#292929"},"dark":{"cal-brand":"#f97316"}},"hideEventTypeDetails":false,"layout":"month_view"});
  </script>
  <!-- Cal element-click embed code ends -->

  ---

  <!-- Cal element-click embed code begins -->
<script type="text/javascript">
  (function (C, A, L) { let p = function (a, ar) { a.q.push(ar); }; let d = C.document; C.Cal = C.Cal || function () { let cal = C.Cal; let ar = arguments; if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; } if (ar[0] === L) { const api = function () { p(api, arguments); }; const namespace = ar[1]; api.q = api.q || []; if(typeof namespace === "string"){cal.ns[namespace] = cal.ns[namespace] || api;p(cal.ns[namespace], ar);p(cal, ["initNamespace", namespace]);} else p(cal, ar); return;} p(cal, ar); }; })(window, "https://app.cal.com/embed/embed.js", "init");
Cal("init", "tax-monitor-service-intro", {origin:"https://app.cal.com"});

  
  // Important: Please add the following attributes to the element that should trigger the calendar to open upon clicking.
  // `data-cal-link="tax-monitor-pro/tax-monitor-service-intro"`
  // data-cal-namespace="tax-monitor-service-intro"
  // `data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'`

  Cal.ns["tax-monitor-service-intro"]("ui", {"cssVarsPerTheme":{"light":{"cal-brand":"#292929"},"dark":{"cal-brand":"#f97316"}},"hideEventTypeDetails":false,"layout":"month_view"});
  </script>
  <!-- Cal element-click embed code ends -->
