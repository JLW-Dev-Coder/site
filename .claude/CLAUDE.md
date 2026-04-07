# CLAUDE.md — virtuallaunch.pro
Last updated: 2026-04-04

---

## 1. Identity

**Repo:** virtuallaunch.pro
**Product:** Virtual Launch Pro (VLP)
**Domain:** virtuallaunch.pro
**Worker API:** api.virtuallaunch.pro
**Role:** Canonical backend hub for all 8 platforms in the VLP ecosystem

---

## 2. What This Repo Is

The single source of truth for:
- All backend routes (Cloudflare Worker)
- All contracts (versioned JSON schemas)
- All shared infrastructure (auth, billing, tokens, affiliates)
- The VLP web frontend (`/web`)

Every other platform calls this Worker. No platform owns its own backend.

---

## 3. What This Repo Is NOT

- Not a platform frontend repo (beyond VLP's own `/web`)
- Not a place for TMP, TTMP, TTTMP, DVLP, GVLP, TCVLP, or WLVLP routes to live independently
- Not a CMS or content system
- Not a batch generation system (that belongs to TTMP repo)

---

## 4. Pre-Task Self-Check (answer before writing any code)

1. **Does this belong in VLP Worker or a platform frontend?**
   - Backend logic → VLP Worker (`workers/src/index.js`)
   - UI/pages → platform frontend repo
   - Never build new backend routes in platform repos

2. **Is there an existing contract for this route?**
   - Check `/contracts/registries/` before creating anything new
   - Never duplicate an existing contract

3. **Does this route already exist in `workers/src/index.js`?**
   - Grep for the route pattern first
   - Never add a duplicate route

4. **Does this change the write pipeline?**
   - Order must always be: validate → receipt → R2 canonical → D1 projection
   - Never deviate from this order

5. **Am I in the right repo?**
   - VLP: Worker, contracts, shared infrastructure
   - Platform repos: frontend only, no new Workers

---

## 5. Platform Registry

| Platform | Abbrev | Domain | Role |
|----------|--------|--------|------|
| Virtual Launch Pro | VLP | virtuallaunch.pro | Core hub — auth, billing, tokens, affiliates |
| Tax Monitor Pro | TMP | taxmonitor.pro | Taxpayer directory + memberships |
| Transcript Tax Monitor Pro | TTMP | transcript.taxmonitor.pro | IRS transcript parsing + reports |
| Tax Tools Arcade | TTTMP | taxtools.taxmonitor.pro | Tax education games + IRS form tools |
| Developers VLP | DVLP | developers.virtuallaunch.pro | Freelancer/client matching |
| Games VLP | GVLP | games.virtuallaunch.pro | Gamified subscription platform |
| Tax Claim VLP | TCVLP | taxclaim.virtuallaunch.pro | Auto Form 843 generator |
| Website Lotto VLP | WLVLP | websitelotto.virtuallaunch.pro | Canva-site marketplace |

**Build dependency order:** TTTMP/TCVLP tools → TTMP transcripts → TMP/DVLP/GVLP memberships → VLP + WLVLP distribution

---

## 6. Migration Status

Track legacy Worker retirement here. Update as work completes.

| Platform | Legacy Worker Exists | Routes Ported to VLP | Frontend Updated | Worker Deleted |
|----------|---------------------|---------------------|-----------------|----------------|
| TTMP | ✅ Yes | ✅ Complete (24/24) | ✅ Complete | ✅ Deleted |
| TTTMP | ✅ Yes | ✅ Complete (13/13) | ✅ Complete | ✅ Deleted |
| TMP | ✅ Yes | ✅ Complete | ✅ Complete | ✅ Deleted |
| DVLP | ✅ Yes (deleted) | ✅ 30 routes in VLP | ✅ Complete (Next.js 15) | ✅ Deleted |
| GVLP | ✅ Yes (empty) | ✅ 9 routes | ✅ Complete | ✅ Deleted |
| TCVLP | ✅ Yes (234 lines) | ✅ 8 routes | 🔄 In progress | 🔄 In progress |
| WLVLP | ❌ No | ✅ 13 routes | ✅ Complete | N/A (never had one) |

---

## 7. Current Build Phase

| Phase | Name | Status | Completed |
|-------|------|--------|-----------|
| 1 | TTTMP Tools Foundation | complete | 2026-03-29 |
| 2 | TTMP Transcript Dashboard | complete | — |
| 3 | Affiliate Program (Stripe Connect Express) | complete | 2026-03-30 |
| 4 | VLP Membership Subscription Renewals | complete | 2026-04-04 |
| 5 | VLP Pricing Page Update | complete | 2026-04-04 |
| 6 | VLP SCALE Batch Generator + Email Copy | complete | 2026-04-05 |
| 7 | VLP Asset Page Route + R2 Push | complete | 2026-04-05 |
| 8 | Test Full Workflow End to End | not started | — |
| 9 | TMP + DVLP + GVLP Membership Tiers | not started | — |
| 10 | WLVLP Marketplace | not started | — |

---

## 8. Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router) + Tailwind + `@cloudflare/next-on-pages` |
| Backend | Single Cloudflare Worker (`workers/src/index.js`) — deny-by-default |
| Database | Cloudflare D1 (`DB` binding) — projection only, never source of truth |
| Storage | Cloudflare R2 (`R2_VIRTUAL_LAUNCH` binding) — always authoritative |
| Auth | `vlp_session` HttpOnly cookie, Google OAuth, Magic Link, TOTP 2FA |
| Billing | Stripe (hosted + embedded checkout, webhook reconciliation) |
| Booking | Cal.com OAuth + webhook |
| Affiliates | Stripe Connect Express, 20% flat lifetime commission |

### Key Files/web/lib/api/client.ts          → API client (fetches from api.virtuallaunch.pro)
/web/lib/auth/session.ts        → getSession() + getSessionToken()
/web/middleware.ts              → Auth guard on dashboard routes (vlp_session cookie)
/workers/src/index.js           → All Worker routes (deny-by-default)
/workers/migrations/            → D1 migration files
/contracts/                     → Versioned JSON schemas — authoritative
/contracts/contract-registry.json   → Master index
/contracts/registries/          → Per-platform registries
/wrangler.toml                  → Worker config, bindings, non-secret env vars

| `.claude/OAUTH.md` | Google OAuth architecture — client selection, cookie domains, auth flow |

### Repo Locations

| Repo | Local Path |
|------|-----------|
| VLP | `C:\Users\britn\OneDrive\virtuallaunch.pro` |
| TMP | `C:\Users\britn\OneDrive\taxmonitor.pro-site` |
| TTMP | `C:\Users\britn\OneDrive\transcript.taxmonitor.pro` |
| TTTMP | `C:\Users\britn\OneDrive\taxtools.taxmonitor.pro` |
| DVLP | `C:\Users\britn\OneDrive\developers.virtuallaunch.pro` |
| GVLP | `C:\Users\britn\OneDrive\games.virtuallaunch.pro` |
| TCVLP | `C:\Users\britn\taxclaim.virtuallaunch.pro` |
| WLVLP | `C:\Users\britn\OneDrive\websitelotto.virtuallaunch.pro` |

---

## 9. Write Pipeline (never deviate)

Every mutating request must follow this exact sequence:
Contract validation       → reject if invalid
Receipt written to R2     → immutable event record
Canonical R2 object updated → source of truth
D1 index updated          → projection only
Response returned


R2 is always authoritative. D1 is always a queryable projection.

---

## 10. Platform Ownership Boundaries

**VLP owns (no other platform may write these directly):**
- accounts
- billing
- bookings
- memberships
- profiles
- support tickets
- tokens

**Platform-specific contracts:** Each platform owns their own domain-specific contracts, stored in VLP repo under `/contracts/registries/{platform}-registry.json`.

**Cross-platform writes:** TMP, TTMP, TTTMP, and others may read shared records. All writes to shared records go through VLP API routes — never direct.

---

## 11. Contracts

### Structure/contracts/
├── contract-registry.json         → Master index (references all platform registries)
├── canonical-contract.json        → Schema template — use as reference
├── canonical-registry.json        → Registry entry schema
└── registries/
├── vlp-registry.json
├── tmp-registry.json
├── ttmp-registry.json
├── tttmp-registry.json
├── dvlp-registry.json
├── gvlp-registry.json
├── tcvlp-registry.json
└── wlvlp-registry.json

### Required sections (all 7 must be present)

| Section | Required fields |
|---------|----------------|
| `auth` | `required`, `trustClientIdentityFields`, `type` |
| `contract` | `authority`, `governs`, `path`, `source`, `title`, `usedOnPages`, `validation`, `version` |
| `delivery` | `endpoint`, `method`, `receiptKeyPattern`, `receiptSource`, `signature` |
| `effects` | `dedupeKey`, `eventIdFrom`, `writeOrder`, `writes` |
| `payload` | `additionalProperties`, `properties`, `required`, `type` |
| `response` | `deduped`, `error`, `success` |
| `schema` | `name`, `version` |

`contract.path` must match the actual repo file path exactly.

### Naming convention

`contracts/{platform}/{platform}.{domain}.{action}.v{n}.json`

Examples:
- `contracts/vlp/vlp.auth.google-oauth.v1.json`
- `contracts/ttmp/ttmp.transcript.upload.v1.json`
- `contracts/tttmp/tttmp.tool.form2848.v1.json`

### Adding a new contract (steps in order)

1. Determine platform ownership
2. Create contract file at `contracts/{platform}/{platform}.{action}.v1.json`
3. Verify all 7 sections are present
4. Add entry to `contracts/registries/{platform}-registry.json`
5. Add route handler to `workers/src/index.js`
6. Test with `wrangler dev`

### Contract validation checklist

- [ ] All 7 sections present
- [ ] `contract.path` matches actual file path
- [ ] Platform correctly identified in filename
- [ ] Endpoint follows `/v1/{domain}/{action}` pattern
- [ ] Payload fields documented
- [ ] Response formats defined (success, error, deduped)
- [ ] Receipt key pattern defined
- [ ] Write order specified

### Hard rules

- Never copy a VLP contract into a platform repo
- Never duplicate an existing contract
- Never define contracts for billing, memberships, bookings, profiles, support_tickets, or tokens in platform repos — those belong to VLP
- Every contract must have a corresponding registry entry

---

## 12. Canonical ID Formataccount_id        = ACCT_{UUID}
account_dvlp_id   = DVLP_ACCT_{account_id}
account_gvlp_id   = GVLP_ACCT_{account_id}
account_tcvlp_id  = TCVLP_ACCT_{account_id}
account_tmp_id    = TMP_ACCT_{account_id}
account_ttmp_id   = TTMP_ACCT_{account_id}
account_tttmp_id  = TTTMP_ACCT_{account_id}
account_vlp_id    = VLP_ACCT_{account_id}
account_wlvlp_id  = WLVLP_ACCT_{account_id}
booking_id        = BOOK_YYYYMMDD_{RANDOM}
event_id          = EVT_{UUID}
inquiry_id        = INQ_{UUID}
invoice_id        = INV_{UUID}
job_id            = JOB_{UUID}
membership_id     = MEM_{UUID}
message_id        = MSG_{UUID}
professional_id   = PRO_{UUID}
result_id         = RES_{UUID}
session_id        = SES_{UUID}
ticket_id         = TKT_{UUID}

IDs are globally unique and immutable once assigned.

---

## 13. Token Management

### Grant tokens (correct procedure)

Never use `wrangler r2 object put` with `--pipe` or `echo` on Windows — this corrupts JSON.

**Option A — Admin API route (preferred):**POST /v1/admin/tokens/grant
Body: { "account_id": "ACCT_xxx", "transcript_tokens": 10, "reason": "test grant" }
Requires: valid admin session cookie or Bearer token

**Option B — Manual R2 write (if route unavailable):**
```bash1. Write JSON file locally (never use echo pipe)
'{"account_id":"...","transcript_tokens":100,"tax_game_tokens":0,"updated_at":"2026-04-03T00:00:00.000Z"}' | Out-File -Encoding utf8 tokens_patch.json2. Upload to R2
wrangler r2 object put virtuallaunch-pro tokens/{account_id}.json --file tokens_patch.json3. Update D1 projection
wrangler d1 execute virtuallaunch-pro --remote --command "UPDATE tokens SET transcript_tokens = X WHERE account_id = 'ACCT_xxx'"4. Delete temp file
del tokens_patch.json5. Verify
wrangler r2 object get virtuallaunch-pro tokens/{account_id}.json --pipe

R2 is always authoritative. D1 must match R2 after any manual grant.

### TTMP legacy token notes

- Legacy TTMP Worker used a Durable Object (TokenLedger) for token balance tracking
- VLP uses `/r2/tokens/{account_id}.json` as canonical storage
- Do NOT recreate the Durable Object in VLP
- VLP token system is the permanent replacement

---

## 14. TTMP Route Migration Status

### Ported to VLP (24 routes — complete)

- GET  /v1/auth/session
- POST /v1/auth/magic-link/request
- GET  /v1/auth/magic-link/verify
- POST /v1/auth/logout
- GET  /v1/pricing
- POST /v1/checkout/sessions
- GET  /v1/checkout/status
- POST /v1/webhooks/stripe
- GET  /v1/tokens/balance/{account_id}
- POST /v1/transcripts/upload
- POST /v1/tools/transcript-parser
- GET  /v1/support/tickets/by-account/{account_id}
- GET  /v1/support/tickets/{ticket_id}
- PATCH /v1/support/tickets/{ticket_id}
- POST /v1/support/tickets

### Needs VLP equivalent (10 routes — pending)

- POST /v1/tokens/consume
- POST /v1/tokens/credit
- GET  /v1/transcripts/reports
- GET  /v1/transcripts/purchases
- POST /v1/transcripts/report-link
- GET  /v1/transcripts/report-link
- GET  /v1/transcripts/report-data
- GET  /v1/transcripts/report
- POST /v1/transcripts/report-email
- POST /v1/transcripts/preview

---

## 15. Security Rules

### Data storage boundaries

| Store | Allowed | Never store here |
|-------|---------|-----------------|
| R2 | Canonical records, receipts, transcripts (TTL-scoped), results | — |
| D1 | Index projections, queryable metadata | Raw docs, session tokens |
| KV | Feature flags, public catalog metadata, routing config, anonymous counters | PII, transcript results, support ticket details |

KV is eventually consistent and globally replicated. Never store PII in KV.

### Cookie requirements

Every session cookie must have all three attributes set explicitly:HttpOnly; Secure; SameSite=Lax
Never relax these attributes for any new auth surface.

### Authorization on every private mutation

1. Validate session token
2. Check account's membership tier / entitlements
3. Verify account owns the resource being mutated (no IDOR)
4. Reject before any write begins — never after

Server Actions in Next.js are public HTTP endpoints. Apply the same checks.

### Rate limiting — required endpoints

The following must have rate limiting applied before any new route in these groups ships:POST /v1/auth/magic-link/request
POST /v1/auth/google/start
POST /v1/auth/2fa/challenge/verify
POST /v1/tools/*
POST /v1/transcripts/*
POST /v1/support/tickets
POST /v1/uploads/*

### PII minimization

- Do not store raw uploaded documents beyond the processing window
- Do not store full transcript text longer than required for the job result
- Store derived results and IDs, not originals, wherever possible
- WLVLP public surfaces must contain zero PII — no account data, no client records, no tax data

### CORS + session

- Worker CORS locked to `https://virtuallaunch.pro` — no other origin accepted
- Session managed exclusively via `vlp_session` HttpOnly cookie — never localStorage or headers

---

## 16. Cloudflare Build Config

| Platform | Pages Project | Build Command | Output Dir | Adapter |
|----------|--------------|---------------|-----------|---------|
| VLP | `virtuallaunch-pro-web` | `cd web && npm install && npm run pages:build` | `web/.vercel/output/static` | `@cloudflare/next-on-pages` |
| TMP | `taxmonitor-pro-site` | `npm run build` | `out` | static export |
| TTMP | `transcript-taxmonitor-pro` (Worker) | `npm run cf:build` | `.open-next/` | `@opennextjs/cloudflare` (Workers, not Pages) |
| TTTMP | `taxtools-taxmonitor-pro-site` | `npx @cloudflare/next-on-pages` | `.vercel/output/static` | `@cloudflare/next-on-pages` |
| DVLP | `developers-virtuallaunch-pro-site` | `npm run pages:build` | `.vercel/output/static` | `@cloudflare/next-on-pages` |
| GVLP | `games-virtuallaunch-pro` | `npm run build` | `out` | static export |
| TCVLP | `taxclaim-virtuallaunch-pro` | `npm run build` | `out` | static export |
| WLVLP | `websitelotto-virtuallaunch-pro` | `npm run build` | `out` | static export |

**TTMP deployment note:** TTMP uses Cloudflare Workers (not Pages) via `@opennextjs/cloudflare` and GitHub Actions CI/CD. `@cloudflare/next-on-pages` is deprecated by Cloudflare. All other platforms remain on Pages. The TTMP Worker uses a KV namespace (`NEXT_INC_CACHE_KV`) for incremental cache. See TTMP repo CLAUDE.md for full build documentation.

**Notes (do not change without updating this table):**
- TTMP: `npm run cf:build` is correct — not `npm run build`
- DVLP: has a `wrangler.toml` with R2 and KV bindings — do not overwrite it
- TMP: static export takes precedence — works correctly
- Root directory is empty (repo root) for all projects
- Never set output to `public/`, `dist/`, `.next/`, or repo root

---

## 17. Commands

### Worker
```bashwrangler dev                                                # Local Worker dev
wrangler deploy                                             # Deploy to production
wrangler d1 migrations apply virtuallaunch-pro --remote    # Run D1 migrations
wrangler secret put SECRET_NAME                            # Set a secret
wrangler tail                                               # Stream live logs

### Frontend (VLP web)
```bashcd web
npm run dev           # Local dev
npm run build         # Production build
npm run pages:build   # Build for Cloudflare Pages

---

## 18. Deployment

| Service | URL / ID |
|---------|---------|
| Frontend | https://virtuallaunch.pro |
| Worker API | https://api.virtuallaunch.pro |
| D1 | virtuallaunch-pro (id: 079dfd69-dbf4-4070-bc91-51f837021795) |
| R2 | virtuallaunch-pro |
| Cloudflare Account | b14e124b2f5dd7e86dfb1546f9ed6e91 |

Secrets are managed via `wrangler secret put` — never committed to the repo.

---

## 19. VLP Membership Tier Mapping

Customer-facing tier names differ from internal plan keys and Stripe product names.
Do not rename Stripe products — active subscriptions exist.

| Customer tier | Price | Internal plan_key | Stripe product name | Stripe product ID |
|--------------|-------|-------------------|--------------------|--------------------|
| Listed | $0/mo | vlp_free | (none) | (none) |
| Active | $79/mo | vlp_starter | VLP Starter | prod_U7PDtTKvnjGuxE |
| Featured | $199/mo | vlp_scale | VLP Scale | prod_U7PJAioATefEi7 |
| Premier | $399/mo | vlp_advanced | VLP Advanced | prod_U7PM0qbFA2hFeM |

Monthly token allocations (added to balance on each renewal):

| Plan key | Transcript tokens | Game tokens |
|----------|------------------|-------------|
| vlp_free | 0 | 0 |
| vlp_starter | 2 | 5 |
| vlp_scale | 5 | 15 |
| vlp_advanced | 10 | 40 |

Note: vlp_pro price IDs in wrangler.toml point to the same Stripe product as vlp_scale.
Both plan keys should grant identical token amounts.

---

## 20. Phased Build Plan

### Phase 1 — TTTMP: Usable Tools (foundation) — COMPLETE (2026-03-29)
- IRS form autofill (2848, 8821)
- Basic transcript parser
- Token deduction on use
- `/api/tools/*` Worker endpoints backed by TTTMP contracts

### Phase 2 — TTMP: Transcript Dashboard (productization) — COMPLETE
- Transcript job submission + result history
- Monitoring dashboard
- Token balance display

### Phase 3 — Affiliate Program (Stripe Connect Express) — COMPLETE (2026-03-30)
- Auth flows wired to tool access gating
- Token purchase via Stripe
- Membership tier enforcement on tool access
- Affiliate program (6 routes, Stripe Connect Express)

### Phase 4 — VLP Membership Subscription Renewals — COMPLETE (2026-04-04)
- Fixed token grant amounts to correct monthly allocations
- Added VLP subscription renewal handler in Stripe webhook
- Token accumulation on renewals (not reset)
- Preserves token balances on subscription cancellation
- Added tier mapping documentation
- SCALE Operator Dashboard expansion (analytics, CSV parsing, Cal.com/Stripe attribution)

### Phase 5 — VLP Pricing Page Update — COMPLETE (2026-04-04)
- Updated pricing page with correct customer-facing tier names (Listed/Active/Featured/Premier)
- Fixed token allocations to match section 19
- Corrected plan keys to remove billing interval suffix
- Fixed checkout endpoint to use `/v1/checkout/sessions`
- Created checkout success page at `/checkout/success`

### Phase 6 — VLP SCALE Batch Generator + Email Copy — COMPLETE (2026-04-05)
- Created directory structure: scale/prospects/, scale/batches/, scale/hunter/
- Built generate-vlp-batch.js implementing selection logic, slug generation, asset page creation
- Email personalization by credential (EA/CPA/JD) and firm_bucket
- Hunter.io CSV export with RFC-4180 compliance
- Source CSV tracking with vlp_email_1_prepared_at timestamps

### Phase 7 — VLP Asset Page Route + R2 Push — COMPLETE (2026-04-05)
- Dynamic asset page at web/app/(marketing)/asset/[slug]/page.tsx
- Fetches prospect data from GET /v1/scale/asset/:slug
- R2 key pattern: vlp-scale/asset-pages/{slug}.json
- Created scale/push-vlp-asset-pages.js for R2 upload

### Phase 8 — Test Full Workflow End to End (next)

### Phase 9 — TMP + DVLP + GVLP Membership Tiers
- Tax pro directory (TMP) — taxpayer intake + matching
- Developer marketplace (DVLP) — Free + $2.99 intro tier
- Gamified subscriptions (GVLP) — $9/$19/$39/mo

### Phase 10 — WLVLP Marketplace
- Canva site exports served as static content under `/sites/[slug]/`
- Next.js is the system layer — do NOT convert Canva exports to React
- Voting/bidding calls private Worker only at mutation point — no PII in responses

---

## VLP SCALE Pipeline

### Directory structure
scale/
├── prospects/    ← source CSVs (gitignored)
├── batches/      ← generated JSON batches (committed)
├── hunter/       ← Hunter.io import CSVs (committed)
└── generate-vlp-batch.js

### Daily batch generation
1. Run: node scale/generate-vlp-batch.js scale/prospects/{source}.csv
2. Push asset pages to R2: node scale/push-vlp-asset-pages.js scale/batches/vlp-batch-{date}.json --exec
3. Upload scale/hunter/vlp-email1-{date}.csv to Hunter.io
4. Hunter.io sends Email 1
5. After 3 days: generate Email 2 batch, upload to Hunter.io

### Sending via Hunter.io (not VLP Worker)
VLP SCALE uses Hunter.io for email delivery, not the VLP Worker cron.
Import the generated CSV into Hunter Sequences.
Hunter handles sending, tracking, and follow-ups.

---

## Post-Task Rules (mandatory after every task)

1. **Commit:** After completing any task, commit all changed files with a descriptive message. Never leave work uncommitted.
2. **Push:** After committing, run `git push origin main` unless explicitly told not to.
3. **Deploy (if applicable):**
   - VLP Worker changes: run `wrangler deploy` after push
   - VLP frontend changes: push triggers Cloudflare Pages automatically
   - TMP frontend changes: push triggers Cloudflare Pages automatically
   - TTMP changes: run `wrangler deploy` after push (OpenNext Worker, not Pages)
   - Other platforms: push triggers Cloudflare Pages automatically unless noted
4. **Report:** After commit+push+deploy, report the commit hash, deploy version (if applicable), and any errors.