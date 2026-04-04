# VLP Manual Testing Checklist

**Date:** 2026-04-04  
**Site:** https://virtuallaunch.pro  
**Worker API:** https://api.virtuallaunch.pro

## 8a — SCALE Command Center (must be logged in as admin)
- [X] Navigate to `https://virtuallaunch.pro/scale`
- [X] Page loads with "SCALE Command Center" title
- [X] Last fetched timestamp shows in subtitle
- [ ] Pipeline Overview: 4 cards visible (Total Prospects, Eligible, Exhausted, Days Remaining)
- [ ] Pipeline cards show real numbers from R2 data (or zeros if no data pushed yet)
- [ ] Color coding works on Eligible card (green >100, yellow 50-100, red <50)
- [ ] Color coding works on Days Remaining card (red <7, yellow 7-14, green >14)
- [ ] Send Queue: Email 1 and Email 2 queue cards visible
- [ ] Queue cards show counts and mini tables (or empty state if no queue data)
- [ ] Batch History: table visible with column headers
- [ ] If no batches pushed to R2 yet, shows "No batches generated yet"
- [ ] Response Tracking: Bookings and Purchases cards visible
- [ ] Bookings card shows created/cancelled/rescheduled/paid/no_show counts
- [ ] Purchases card shows count and revenue (or "No SCALE-attributed purchases yet")
- [ ] Site Analytics: 8 mini cards visible in grid
- [ ] Each card shows a domain name
- [ ] Cards with data show page views, unique visitors, bandwidth
- [ ] Cards that failed show "Unavailable"
- [ ] Click Refresh button — spinner appears, data reloads
- [ ] After refresh, timestamp updates
- [ ] Resize browser to 768px — cards reflow to 2 per row
- [ ] Resize browser to 375px — cards stack to 1 per row, tables scroll horizontally

## 8b — SCALE sidebar navigation
- [ ] In the VLP app sidebar, "SCALE" link is visible with lightning icon
- [ ] Click it — navigates to `/scale`

## 8c — Cal.com webhook (live test)
- [ ] Open `https://cal.com/vlp/ttmp-discovery?slug=test-webhook-jamie-sd-ca` in a new tab
- [ ] Book a test appointment using your own email
- [ ] Wait 30 seconds
- [ ] Refresh the SCALE Command Center
- [ ] Check Bookings card — "created" count should increment by 1
- [ ] Cancel the test booking in Cal.com
- [ ] Wait 30 seconds, refresh SCALE dashboard
- [ ] "cancelled" count should increment by 1

## 8d — Stripe attribution (live test)
- [ ] Navigate to TTMP pricing page
- [ ] Purchase a 10-token pack using an email address that exists in your prospect index
- [ ] After successful payment, wait 60 seconds
- [ ] Refresh the SCALE Command Center
- [ ] Check Purchases card — count should increment, revenue should increase by $19
- [ ] If the email doesn't match any prospect in the index, the purchase won't appear in SCALE tracking — that's correct behavior

## 8e — Analytics verification
- [ ] On the SCALE Command Center, check that analytics cards load (may take a few seconds)
- [ ] Verify at least `transcript.taxmonitor.pro` and `virtuallaunch.pro` show data
- [ ] If any domain shows "Unavailable," note which one — may indicate the zone isn't in your Cloudflare account or the API token doesn't have access to that zone

## 8f — Existing VLP flows (regression check)
- [ ] Log in to VLP dashboard — dashboard loads normally
- [ ] Navigate to Account — settings page loads
- [ ] Navigate to Support — support page loads, existing tickets visible
- [ ] Submit a test support ticket — confirm it appears
- [ ] Log out — confirm redirect to homepage
- [ ] Attempt to access `/dashboard` while logged out — redirected to login