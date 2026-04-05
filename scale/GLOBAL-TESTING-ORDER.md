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

## Round 3 — Broken platform (fix required)

### 8. TCVLP (taxclaim.virtuallaunch.pro)
No checklist — needs rebuild first
Status: Form 843 generation is not functional
Decision needed: Fix it or take it offline until it works

---

## How to work through this

1. Open the checklist for the current platform
2. Test each item in order
3. Mark pass or fail
4. If fail: note the issue, open a Claude chat, get a fix prompt
5. Re-test the failed item after the fix
6. When all items pass, move to next platform
7. After Round 1 completes: VLP SCALE campaign can launch
