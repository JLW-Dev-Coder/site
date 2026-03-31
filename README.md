# Virtual Launch Pro (VLP)

The canonical backend hub for 8 SaaS platforms. One Cloudflare Worker serves all platforms at `api.virtuallaunch.pro`.

## Platforms

| Platform | Domain | Description |
|---|---|---|
| VLP | virtuallaunch.pro | Core hub — auth, billing, tokens, affiliates |
| TMP | taxmonitor.pro | Tax professional directory + taxpayer memberships |
| TTMP | transcript.taxmonitor.pro | IRS transcript parsing + plain-English reports |
| TTTMP | taxtools.taxmonitor.pro | Tax education games + IRS form tools |
| DVLP | developers.virtuallaunch.pro | Freelancer/client matching marketplace |
| GVLP | games.virtuallaunch.pro | Gamified subscription platform |
| TCVLP | taxclaim.virtuallaunch.pro | Auto Form 843 generator + tax claim management |
| WLVLP | websitelotto.virtuallaunch.pro | Canva-site marketplace with voting/bidding/buy-now |

## Architecture

- **Backend:** Single Cloudflare Worker (`workers/src/index.js`) — 190+ routes, deny-by-default
- **Frontend:** Next.js 15/16 (App Router) + Tailwind, deployed to Cloudflare Pages per platform
- **Database:** Cloudflare D1 (`virtuallaunch-pro`) — projection only, never source of truth
- **Storage:** Cloudflare R2 (`virtuallaunch-pro`) — always authoritative
- **Auth:** `vlp_session` HttpOnly cookie, Google OAuth, Magic Link, TOTP 2FA
- **Billing:** Stripe (hosted + embedded checkout, webhook reconciliation)
- **Affiliates:** Stripe Connect Express, 20% flat lifetime commission

## Cloudflare Pages Build Config

| Platform | Build Command | Output Dir | Adapter |
|---|---|---|---|
| VLP | `cd web && npm install && npm run pages:build` | `web/.vercel/output/static` | `@cloudflare/next-on-pages` |
| TMP | `npm run build` | `out` | static export |
| TTMP | `npm run pages:build` | `.open-next/assets` | OpenNext |
| TTTMP | `npx @cloudflare/next-on-pages` | `.vercel/output/static` | `@cloudflare/next-on-pages` |
| DVLP | `npm run pages:build` | `.vercel/output/static` | `@cloudflare/next-on-pages` |
| GVLP | `npm run build` | `out` | static export |
| TCVLP | `npm run pages:build` | `.vercel/output/static` | `@cloudflare/next-on-pages` |
| WLVLP | `npm run build` | `out` | static export |

## Key Rules

- Backend logic always goes in VLP Worker — never in platform repos
- Write pipeline: validate → receipt R2 → canonical R2 → D1 projection
- R2 is authoritative, D1 is projection only
- All contracts require 7 sections: auth, contract, delivery, effects, payload, response, schema
- Session via `vlp_session` HttpOnly cookie only — never localStorage

## Repo Locations

All repos live at `C:\Users\britn\OneDrive\` except TCVLP which is at `C:\Users\britn\taxclaim.virtuallaunch.pro`

| Repo | Path |
|---|---|
| VLP | `C:\Users\britn\OneDrive\virtuallaunch.pro` |
| TMP | `C:\Users\britn\OneDrive\taxmonitor.pro-site` |
| TTMP | `C:\Users\britn\OneDrive\transcript.taxmonitor.pro` |
| TTTMP | `C:\Users\britn\OneDrive\taxtools.taxmonitor.pro` |
| DVLP | `C:\Users\britn\OneDrive\developers.virtuallaunch.pro` |
| GVLP | `C:\Users\britn\OneDrive\games.virtuallaunch.pro` |
| TCVLP | `C:\Users\britn\taxclaim.virtuallaunch.pro` |
| WLVLP | `C:\Users\britn\OneDrive\websitelotto.virtuallaunch.pro` |

## Commands

### Worker
```bash
wrangler dev                                                # Local dev
wrangler deploy                                             # Deploy to production
wrangler d1 migrations apply virtuallaunch-pro --remote    # Run D1 migrations
wrangler secret put SECRET_NAME                            # Set a secret
wrangler tail                                               # Stream live logs
```

### Frontend (VLP web)
```bash
cd web
npm run dev           # Local dev
npm run build         # Production build
npm run pages:build   # Build for Cloudflare Pages
```

## Deployment

| Service | URL |
|---|---|
| Frontend | https://virtuallaunch.pro |
| Worker API | https://api.virtuallaunch.pro |
| D1 | virtuallaunch-pro (id: 079dfd69-dbf4-4070-bc91-51f837021795) |
| R2 | virtuallaunch-pro |
| Cloudflare Account | b14e124b2f5dd7e86dfb1546f9ed6e91 |

## Current Phase

Phase 3 — Affiliate Program (next to build)
- 6 routes: onboard, callback, dashboard, events, payout request, payout status
- Stripe Connect Express accounts
- 20% flat lifetime commission on all purchases across all platforms
- Config already in wrangler.toml: `AFFILIATE_COMMISSION_RATE = "0.20"`