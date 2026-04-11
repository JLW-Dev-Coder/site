# CLAUDE.md — virtuallaunch.pro
Last updated: 2026-04-10

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
| 10 | WLVLP Marketplace | in progress | — |

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

### Canonical Contracts

#### Profile contracts

| Contract | Path | Endpoint |
|----------|------|----------|
| Public profile (full) | `/contracts/vlp/vlp.profile.public.v1.json` | `GET /v1/profiles/public/:professional_id` |
| Directory listing (truncated) | `/contracts/vlp/vlp.profiles.list.v1.json` | `GET /v1/profiles` |

- `vlp.profile.public.v1.json` is the **single source of truth** for the full nested profile schema across all 8 platforms. Its field structure is aligned with and replaces the TMP `directory-profile.v1.json` rendering reference.
- The TMP repo's `contracts/directory-profile.v1.json` is a **rendering reference only** — it documents how TMP renders profile data on its directory pages. The VLP contract is authoritative for the API shape.
- `vlp.profiles.list.v1.json` returns truncated card-level fields for directory search, filtering, and listing.
- The old `contracts/profile/profile.public.get.v1.json` is deleted. The registry entry `profile_public` (in `vlp-registry.json`) replaces the former `profile_public_get`.

#### Compliance record contracts

| Contract | Path | Endpoint |
|----------|------|----------|
| Compliance record write (staff) | `/contracts/tmp/tmp.compliance-record.write.v1.json` | `POST /v1/tmp/compliance-records` |
| Compliance record read (client report) | `/contracts/tmp/tmp.compliance-record.read.v1.json` | `GET /v1/tmp/compliance-records/:order_id/report` |

- The **write** contract governs the full staff compliance record — the working document a tax professional fills out during the Phase 2 Processing / Due Diligence step. Dedupes by `order_id`; canonical R2 key is `compliance_records/{order_id}.json`; receipts land at `receipts/tmp/compliance-records/{order_id}.json`. Staff-only.
- The **read** contract is the **client-facing** projection of the same canonical record, filtered to client-safe fields only. Excludes: `ssn_last4`, all IRS representative/agent fields, `compliance_internal_notes`, `compliance_internal_next_steps`, `irs_call_*`, `ro_*`, `transcript_*`, `auth_*`, `source`, and `servicing_professional_id`. Notice `details` are truncated to 500 chars. No writes.
- Both contracts derive their schema from the live staff form at `taxmonitor.pro-site/app/pages/staff/compliance-records.html` — every `data-field` attribute maps to a contract field. Enum values are copied verbatim from the form selects/checkboxes.

#### Client Pool contracts

| Contract | Path | Endpoint |
|----------|------|----------|
| Client Pool case accept | `/contracts/tmp/tmp.client-pool.accept.v1.json` | `POST /v1/tmp/client-pool/accept` |
| Client Pool case list | (read-model, no contract file yet) | `GET /v1/tmp/client-pool` |

- **Accept** is the write-path for a tax professional claiming an available case from the Client Pool. Dedupes by `case_id`; canonical R2 key is `client_pool/{case_id}.json`; receipts land at `receipts/tmp/client-pool/accept/{case_id}.json`. Write order: receiptAppend → canonicalUpsert → D1 projection (best-effort — `client_pool` D1 table does not yet exist). First-claim-wins: returns 409 `case_not_available` if `status !== 'available'`. Re-accepting a case already owned by the same pro returns a deduped success (idempotent replay). `professional_id` is resolved server-side from the session's linked `profiles` row — never trusted from the client body.
- **List** is a read-model scan of R2 under the `client_pool/` prefix. Filters: `?status=available`, `?professional_id={id}`, `?page=1&limit=20`. Response shape: `{ ok, cases, pagination: { page, limit, total, total_pages } }`. Requires session. No D1 projection exists — all reads hit R2 directly. When case volume grows, a `client_pool` D1 projection + migration should be added so listing can be paginated from a queryable index.

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

### Phase 10 — WLVLP Marketplace (in progress)
- Canva site exports served as static content under `/sites/[slug]/`
- Next.js is the system layer — do NOT convert Canva exports to React
- Voting/bidding calls private Worker only at mutation point — no PII in responses
- See section 21 for operational reference (routes, pricing, infrastructure)

---

## 20a. Admin Endpoints

Operator-only routes gated by a hardcoded admin email allowlist
(`['jamie.williams@virtuallaunch.pro', 'hello@virtuallaunch.pro']`) inside
each handler. All require a valid `vlp_session` cookie. Non-allowlisted
sessions receive `403 FORBIDDEN`.

| Method | Path | Purpose |
|--------|------|---------|
| GET   | `/v1/admin/stats` | Returns `{ ok, total_accounts, paid_accounts, memberships_by_tier, tokens, recent_transactions, stripe_transactions[], stripe_errors[] }`. `paid_accounts` is `COUNT(DISTINCT a.account_id)` of accounts joined to `memberships` where `m.status='active'`. Pulls live **payment intents** (`/v1/payment_intents?limit=25`) from both VLP and TMP Stripe accounts. Falls back to `/v1/checkout/sessions?limit=25` per account when payment_intents returns empty. `receipt_url` is intentionally left blank to avoid a second per-row API call. |
| GET   | `/v1/admin/stats?include=clients` | Same as above, plus `clients[]` with `{ account_id, name, email, platform, created_at }` for every account in `accounts` (ordered by `created_at DESC`). `name` joins to `profiles.display_name`, falls back to `first_name + last_name`, then to the email prefix. Used by the `/scale/crm` page and the `/scale/crm/clients` table. |
| GET   | `/v1/admin/accounts/:account_id` | Single-account drill-down. Returns `{ ok, account: { id, account_id, email, name, platform, status, created_at, updated_at }, memberships[], tokens: { transcript_total, tax_game_total, updated_at }, tickets[], payments[] }`. The `payments` field calls Stripe `/v1/payment_intents?customer={id}` if the account has a `stripe_customer_id` in `billing_customers` (or on a membership row); otherwise it falls back to `/v1/payment_intents/search?query=receipt_email:"…"`. Tries the VLP Stripe key first, then the TMP key. Returns an empty array on lookup failure. |
| GET   | `/v1/admin/support/tickets` | Returns up to 100 cross-platform tickets (joined to `accounts` for `email` + `platform`), with `messages[]` hydrated from R2 (`support_tickets/{id}.json`). Initial user message is seeded from the D1 row when no R2 thread exists yet. |
| PATCH | `/v1/admin/support/tickets/:ticket_id` | Body: `{ message?, status? }`. Appends an operator reply (`author: 'support'`) to the R2 ticket's `messages[]` thread, sets status to `awaiting` (or the supplied status), updates the D1 projection, and returns the full updated ticket. R2 is authoritative; D1 mirrors `status` / `updated_at`. |
| GET   | `/v1/admin/scale/workflow` | Serves the canonical SCALE workflow doc as `text/markdown`. Reads `vlp-scale/workflow.md` from R2 and returns the body verbatim with `Content-Type: text/markdown; charset=utf-8` and `Cache-Control: no-store`. Returns `{ ok: false, error: "WORKFLOW.md not found in R2" }` (404) if the R2 object is missing. Used by the Pipeline tab on `/scale` to render the live workflow reference. **Sync local edits to R2 via `node scale/push-workflow.js`** — the script reads `scale/WORKFLOW.md` and uploads it to `vlp-scale/workflow.md` via `wrangler r2 object put --remote --content-type text/markdown`. R2 is authoritative; the local markdown file in the repo is the editable source. |
| GET   | `/v1/admin/analytics/all` | Cloudflare Analytics summary across all 8 platforms. Query params: `since` (ISO, default `now - 7d`), `until` (ISO, default `now`). Backed by the **`httpRequests1dGroups`** dataset (Free plan compatible). **Zone-dedup optimization:** the 8 platforms map to only 2 unique zones (VLP zone hosts vlp/dvlp/gvlp/tcvlp/wlvlp; TMP zone hosts tmp/ttmp/tttmp), so this endpoint issues exactly **2 GraphQL calls** in parallel via `Promise.allSettled` and reuses each result for every platform on that zone. Returns `{ ok, since, until, platforms: { vlp: { domain, shared_zone, shared_with, total_requests, page_views, unique_visitors, bandwidth_bytes, threats, cache_hit_ratio }, tmp: {...}, ... } }`. Per-platform errors surface as `{ domain, shared_zone, shared_with, error }`. Uses bearer token `env.CF_API_TOKEN`. |
| GET   | `/v1/admin/bookings` | Cal.com bookings across all platforms. Tries Cal.com API v2 first (`Authorization: Bearer`), falls back to v1 (`?apiKey=`). Returns `{ ok, bookings: [{ id, title, status, start, end, attendee_name, attendee_email, event_type_slug, created_at }], counts: { all, cancelled, completed, confirmed, pending, rescheduled, upcoming }, event_types: { platform: [{ slug, label }] }, api_version }`. Counts are derived from the bookings array. Cached in `ENRICHMENT_KV` under key `cal_bookings_cache` with 300s TTL. Requires `CAL_API_KEY` Worker secret. |
| GET   | `/v1/admin/analytics/:platform` | Per-platform analytics deep-dive. `:platform` ∈ `{vlp, tmp, ttmp, tttmp, dvlp, gvlp, tcvlp, wlvlp}`. Same `since`/`until` query params. Backed by **`httpRequests1dGroups`** with date-only filters (`date_gt` / `date_lt`, exclusive — automatically widened by 1 day on each side to include boundary days). Returns `{ ok, platform, domain, since, until, shared_zone, shared_with, traffic: { total_requests, cached_requests, total_bytes, cached_bytes, page_views, unique_visitors, threats, cache_hit_ratio, timeseries: [{ date, requests, cached, bytes, pageViews, uniques }] }, status_codes: [{ status, count }], top_paths: [], top_countries: [{ country, requests, threats }], firewall: [{ action, count }] }`. Status codes and country breakdowns come from the nested `responseStatusMap` / `countryMap` arrays inside the same single GraphQL call — no separate sub-queries. **Free-plan limitations:** `top_paths` is always `[]` (per-path breakdowns require `httpRequestsAdaptiveGroups` on Pro+); `firewall` is fetched best-effort via `firewallEventsAdaptiveGroups` and falls back to `[]` if the call errors. **Subdomain data sharing:** since the 1d dataset can't filter by host, subdomain platforms return ZONE-WIDE totals shared with their parent. The `shared_zone: true` flag plus `shared_with: ["domain1", "domain2", ...]` array let the frontend label this clearly. Upgrading to Pro re-enables per-subdomain isolation by switching back to the adaptive dataset with `clientRequestHTTPHost` filtering. On GraphQL failure returns `{ ok: false, error }` with HTTP 502. |

Frontend usage: the SCALE operator console (`/scale/support`) reads from
`GET /v1/admin/support/tickets` and submits replies via
`PATCH /v1/admin/support/tickets/:ticket_id` with `{ message }`. Do not
route operator replies through the user-facing
`PATCH /v1/support/tickets/:ticket_id` — that handler overwrites the
ticket's `message` column instead of appending to a thread.

---

## 21. WLVLP Operational Reference

WLVLP is operational and live. All backend routes live in `workers/src/index.js`. WLVLP never had its own Worker.

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST  | `/v1/wlvlp/checkout` | Create Stripe Checkout session for site purchase or hosting |
| PATCH | `/v1/wlvlp/sites/:slug/data` | Site editor — owner-only mutation of site customizations |
| GET   | `/v1/wlvlp/sites/by-account/:account_id` | List all sites owned by an account |
| POST  | `/v1/wlvlp/sites/:slug/domain` | Connect a custom domain to a purchased site |
| GET   | `/v1/wlvlp/sites/expiring` | Cron-facing endpoint listing sites with hosting expiring soon |
| POST  | `/v1/wlvlp/sites/:slug/renew` | Renew hosting subscription for a site |

Plus existing read routes for the marketplace catalog, voting, bidding, and scratch tickets.

### Pricing model (one-time + recurring hosting)

| SKU | Type | Price |
|-----|------|-------|
| Standard site | One-time | $249 |
| Premium site | One-time | $399 |
| Hosting (Standard) | Monthly recurring | $14/mo |
| Premium Hosting | Monthly recurring | $49/mo |

Acquisition methods: Buy Now ($249/$399), Auction (min $29 bid), Scratch to Win.

### Dual Stripe accounts

WLVLP, VLP, GVLP, and TTTMP charges flow through the **VLP Stripe account**. TMP (and the legacy TMP family) flows through the **TMP Stripe account**. Two key pairs exist on the Worker:

| Family | Secret key env var | Webhook secret env var |
|--------|--------------------|------------------------|
| TMP | `STRIPE_SECRET_KEY` | `STRIPE_WEBHOOK_SECRET` |
| VLP / WLVLP / GVLP / TTTMP | `STRIPE_SECRET_KEY_VLP` | `STRIPE_WEBHOOK_SECRET_VLP` |

When adding a new Stripe API call for any VLP-family product, use `STRIPE_SECRET_KEY_VLP`. Never cross-wire keys — TMP webhooks will fail signature verification against the VLP secret and vice versa.

### D1 tables

- `wlvlp_purchases` — projection of completed site purchases (account_id, slug, sku, stripe_session_id, hosting_status, hosting_renews_at)
- `wlvlp_templates` — projection of the published template catalog (slug, category, tier, status)

R2 remains authoritative for both.

### R2 keys

| Key pattern | Contents |
|-------------|----------|
| `wlvlp/sites/{slug}.json` | Canonical site record (template ref, ownership, hosting state) |
| `wlvlp/sites/{slug}/customizations.json` | Owner-edited site data from the editor |
| `wlvlp/notifications/...` | Outbound notification queue (purchase confirmations, renewal reminders) |

### Cron

A daily cron at **10:00 UTC** sweeps `/v1/wlvlp/sites/expiring` and queues hosting renewal reminders / lapse notifications.

### PII rule

Public marketplace surfaces (catalog, voting, bidding, scratch) must contain zero PII. Owner-only routes (editor, by-account list, domain connect, renew) require a valid `vlp_session` cookie with ownership of the slug.

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

## Enrichment Pipeline

Automated FOIA lead enrichment runs daily under the VLP Worker. Replaces the
manual Clay enrichment loop in the SCALE workflow.

- **Cron:** 10:00 UTC daily (shares the trigger with WLVLP auction settlement; the enrichment branch runs first and falls through)
- **Worker entrypoint:** `handleEnrichmentBatch(env)` in `workers/src/index.js`
- **R2 source / sink:** `vlp-scale/foia-leads/foia-master.json` (NDJSON, one record per line)
- **R2 logs:** `vlp-scale/enrichment-logs/{YYYY-MM-DD}.json`
- **KV namespace:** `ENRICHMENT_KV` (id `eca3b78d3e564774bb4bdebed8ffa512`)
- **KV keys used:**
  - `enrichment:mx:{domain}` — MX presence cache (30 day TTL)
  - `enrichment:catchall:{domain}` — catch-all flag (30 day TTL)
  - `enrichment:pattern:{domain}` — winning pattern index 1..6 (30 day TTL)
  - `enrichment:reoon_budget:{YYYY-MM-DD}` — daily Reoon credit counter (48 hour TTL)
- **Daily Reoon budget:** 450 calls (50-credit buffer below the $9/mo plan's 500/day)
- **Rate limit:** 200ms delay between every Reoon call
- **Processing order:** load NDJSON → filter unenriched → extract domain → MX check → catch-all detection → pattern reuse (KV) → pattern generation (1..6) → Reoon validation → write back NDJSON
- **Pattern order (1..6):** `first@`, `first.last@`, `firstlast@`, `flast@`, `first.l@`, `first_last@`
- **Reoon endpoint:** `https://emailverifier.reoon.com/api/v1/verify?email={email}&key={REOON_API_KEY}&mode=quick`
- **Reoon secret:** `REOON_API_KEY` (Worker secret, set via `wrangler secret put REOON_API_KEY` — never hardcoded)
- **Email statuses written:** `valid`, `pattern_match`, `catch_all`, `no_mx`, `no_valid_pattern`, `no_domain`, `no_name`
- **Memory note:** master file is loaded fully into Worker memory (~25MB / ~88K records). When it grows past ~50MB, switch to chunked processing.

---

## Campaign Router

Unified daily batch generator that routes enriched FOIA leads into
the TTMP, VLP, and WLVLP send queues. Replaces the legacy
`handleWlvlpBatchGeneration` site-crawler at the same cron slot.

- **Worker entrypoint:** `handleDailyBatchGeneration(env)` in `workers/src/index.js`
- **Cron:** 12:00 UTC daily (replaces the old WLVLP batch generator)
- **Manual trigger:** `POST /internal/test-daily-batch` with `X-Internal-Key: $INTERNAL_TEST_KEY`
- **Source:** `vlp-scale/foia-leads/foia-master.json` (NDJSON)
- **Eligibility filter:** record has non-empty `email_found`, `email_status` ∈ {`valid`, `pattern_match`, `catch_all`, `pattern_unvalidated`}, and all three of `ttmp_email_1_prepared_at` / `vlp_email_1_prepared_at` / `wlvlp_email_1_prepared_at` are empty.
- **Daily cap:** `DAILY_BATCH_CAP = 200` total leads/day across all three campaigns. Leaves room under Gmail's 2k/day limit for follow-ups (emails 2-6).
- **Allocation (weighted random per record):** TTMP 65%, VLP 25%, WLVLP 10% (`Math.random()` thresholds 0.65 / 0.90).
- **Output queues:**
  - `vlp-scale/ttmp-send-queue/email1-pending.json`
  - `vlp-scale/vlp-send-queue/email1-pending.json`
  - `vlp-scale/wlvlp-send-queue/email1-pending.json`
- **Append, never overwrite:** existing queue is read, new records appended, then written back.
- **Master mutation:** sets the matching `{ttmp|vlp|wlvlp}_email_1_prepared_at` ISO timestamp on each routed record before writing the master file back as NDJSON.
- **WLVLP asset pages:** for each WLVLP routed record, a minimal asset page is written to `vlp-scale/wlvlp-asset-pages/{slug}.json` so the `/asset/{slug}` link resolves. (No site crawl — the pre-router crawler/scoring path is dropped.)
- **Daily log:** `vlp-scale/batch-logs/{YYYY-MM-DD}.json` with `eligible_records`, `batch_size`, `routed_ttmp`, `routed_vlp`, `routed_wlvlp`, `records_remaining_eligible`, queue sizes.

## TTMP Email Send Pipeline

Drip-style 6-email TTMP outreach driven by the Worker, fed by pattern-generated
addresses (`first.last@domain`).

- **Queue R2 key:** `vlp-scale/ttmp-send-queue/email1-pending.json`
- **Archive R2 key:** `vlp-scale/ttmp-send-queue/sent-{YYYY-MM-DD}.json`
- **Worker entrypoint:** `handleTtmpEmailSend(env)` → `runStagedSendQueue(env, ...)` in `workers/src/index.js`
- **Cron:** 14:00 UTC daily (first of the unified TTMP→VLP→WLVLP send block)
- **Manual trigger:** `POST /internal/test-ttmp-send` with `X-Internal-Key: $INTERNAL_TEST_KEY`
- **Schedule (compressed 10-day cadence):** Email 1 = Day 0, Email 2 = +2, Email 3 = +4, Email 4 = +6, Email 5 = +8, Email 6 = +10
- **Send delays:** 10-15s between Email 1 sends; 8-12s between follow-ups
- **Templates:** stored inline on each queue record (`subject`, `body`, `email_2_subject`, `email_2_body`, … `email_6_subject`, `email_6_body`).
- **Batch source:** the daily campaign router (`handleDailyBatchGeneration`). The legacy `scale/build-ttmp-batch.js` builder is retained for one-off ad-hoc batches but is no longer the primary feed.
- **Status field on queue records:** `pending` → `email_1_sent` → `email_2_sent` → … → `email_6_sent`. Failures set `email_{n}_failed` and copy `last_error`. Records with all 6 emails sent move to the daily archive object.

## VLP Email Send Pipeline

Same shape as the TTMP pipeline. Sends prospects in the VLP membership
campaign to the directory listing pricing page (`virtuallaunch.pro/pricing`)
and an asset page (`virtuallaunch.pro/asset/{slug}`).

- **Queue R2 key:** `vlp-scale/vlp-send-queue/email1-pending.json`
- **Archive R2 key:** `vlp-scale/vlp-send-queue/sent-{YYYY-MM-DD}.json`
- **Worker entrypoint:** `handleVlpEmailSend(env)` → `runStagedSendQueue(env, ...)` in `workers/src/index.js`
- **Cron:** 14:00 UTC daily (second handler in the unified send block)
- **Manual trigger:** `POST /internal/test-vlp-send` with `X-Internal-Key: $INTERNAL_TEST_KEY`
- **Schedule:** identical compressed 10-day cadence as TTMP (Day 0, +2, +4, +6, +8, +10)
- **Send delays:** identical to TTMP (10-15s for Email 1, 8-12s for follow-ups)
- **Templates:** 6 emails inline on the queue record. Personalization variables: `First`, `City`, `credential_label`, `new_client_value` (per credential: EA `$15,000-$90,000/yr`, CPA `$22,500-$120,000/yr`, ATTY `$18,000-$150,000/yr`), `slug`.
- **Batch source:** the daily campaign router (`handleDailyBatchGeneration`).
- **Master mutation on enqueue:** the router sets `vlp_email_1_prepared_at` on the source record.

## WLVLP Email Send Pipeline

6-email Website Lotto outreach (extended from the previous 2-email
flow). Templates target conversion-leak messaging and a site preview
asset page (`websitelotto.virtuallaunch.pro/asset/{slug}`).

- **Queue R2 key:** `vlp-scale/wlvlp-send-queue/email1-pending.json`
- **Archive R2 key:** `vlp-scale/wlvlp-send-queue/sent-{YYYY-MM-DD}.json`
- **Worker entrypoint:** `handleWlvlpEmailSend(env)` → `runStagedSendQueue(env, ...)` in `workers/src/index.js`
- **Cron:** 14:00 UTC daily (third handler in the unified send block)
- **Schedule:** identical compressed 10-day cadence as TTMP (Day 0, +2, +4, +6, +8, +10)
- **Templates:** 6 emails inline on the queue record (was 2 — extended in this batch). Emails 1 and 2 no longer reference per-site crawl scores; the new router uses static templates so it can scale to 200 records/day without crawling each domain.
- **Batch source:** the daily campaign router (`handleDailyBatchGeneration`). The previous `handleWlvlpBatchGeneration` site-crawler is no longer scheduled. Per-prospect site crawl + leak score + bespoke leak report are dropped in favor of static templates.
- **Asset pages:** the router writes a minimal `vlp-scale/wlvlp-asset-pages/{slug}.json` for each routed record so the email's preview link resolves.

## CAN-SPAM Compliance

All outbound campaign emails (TTMP, VLP, WLVLP) include a CAN-SPAM compliant
footer with physical mailing address and a per-recipient unsubscribe link.

- **Physical address:** Lenore, Inc c/o Virtual Launch Pro, 1175 Avocado Avenue Suite 101 PMB 1010, El Cajon, CA 92020
- **Unsubscribe route:** `GET /unsubscribe?email={email}&campaign={ttmp|vlp|wlvlp}` — public, no auth required (CAN-SPAM mandate). Returns a plain HTML confirmation page.
- **Worker entrypoint:** unsubscribe handler lives inline in `workers/src/index.js` fetch handler, before the `/internal/*` routes.
- **Master mutation on unsubscribe:** sets `unsubscribed_at` (ISO timestamp) on the matching `vlp-scale/foia-leads/foia-master.json` record (case-insensitive `email_found` match).
- **Queue mutation on unsubscribe:** flips `status` to `"unsubscribed"` (and sets `unsubscribed_at`) on matching records in all three send queues — `vlp-scale/{ttmp|vlp|wlvlp}-send-queue/email1-pending.json`.
- **Send handler skip:** `runStagedSendQueue` skips any record with `status === 'unsubscribed'` for both Email 1 and Emails 2-6 — no send, no archive, no status change.
- **Enrichment skip:** `handleEnrichmentBatch` skips any record where `unsubscribed_at` is set — no Reoon credits spent on opted-out prospects.
- **Router skip:** `handleDailyBatchGeneration` filters out records where `unsubscribed_at` is set when building the eligibility list.
- **Footer generation:** `canspamTtmpFooter`, `canspamVlpFooter`, `canspamWlvlpFooter` in `workers/src/index.js`. Appended to all 6 email bodies inside `buildTtmpQueueRecord` / `buildVlpQueueRecord` / `buildWlvlpQueueRecord`. The standalone `scale/build-ttmp-batch.js` builder applies the same footer.
- **One-shot backfill route:** `POST /internal/backfill-canspam-footer` (requires `X-Internal-Key`) — idempotently appends the footer to any queue record body that doesn't already contain `1175 Avocado Avenue`.

## 22. Member App

### Overview

The member app is the authenticated dashboard experience for VLP members. It lives under the `(member)` Next.js route group at `web/app/(member)/`. All routes require auth via `vlp_session` cookie (enforced by middleware + `requireAuth()` in the layout).

### Layout

- **Sidebar:** 280px fixed width, scrollable nav — `web/components/member/MemberSidebar.tsx`
- **Topbar:** 80px fixed height, search + notifications + help + avatar dropdown — `web/components/member/MemberTopbar.tsx`
- **Layout:** `web/app/(member)/layout.tsx` — wraps all member pages
- **Background:** `#0a0e27` (Canva-adapted dark theme with VLP orange accents)
- **Icons:** lucide-react

### Sidebar structure

```
WORKSPACE
  Dashboard        /dashboard
  Analytics        /analytics
  Calendar         /calendar
  Inquiries        /inquiries
  Reports          /reports
  Tokens           /tokens

EARNINGS
  Affiliate        /affiliate
  Client Pool      /client-pool (expandable → Client Record)
  Payouts          /payouts

SETUP
  Account          /account (sub: Payments → /account/payments)
  Profile          /profile (sub: Onboarding → /profile/onboarding, Preview → /profile/preview)
  Support          /support
  Usage            /usage

SETTINGS (footer)
  Account, Profile, Back to site, Sign out
```

### Routes (17 pages)

| Path | Page | Status |
|------|------|--------|
| `/dashboard` | Dashboard | Shell |
| `/analytics` | Analytics | Shell |
| `/calendar` | Calendar | Shell |
| `/inquiries` | Inquiries | Shell |
| `/reports` | Reports | Shell |
| `/tokens` | Tokens | Shell |
| `/affiliate` | Affiliate | Shell |
| `/client-pool` | Client Pool | Shell |
| `/client-pool/[clientId]` | Client Record | Built |
| `/payouts` | Payouts | Shell |
| `/account` | Account | Shell |
| `/account/payments` | Payments | Shell |
| `/profile` | Profile | Shell |
| `/profile/onboarding` | Onboarding | Shell |
| `/profile/preview` | Profile Preview | Shell |
| `/support` | Support | Shell |
| `/usage` | Usage | Shell |
| `/notifications` | Notifications | Shell |

**Note:** `/help` is served by the `(marketing)` route group's existing help center page. The topbar help icon links there.

### Design system (member app tokens)

CSS custom properties in `globals.css`:
- `--member-bg: #0a0e27` — background
- `--member-card: rgba(255, 255, 255, 0.04)` — card surfaces
- `--member-border: rgba(255, 255, 255, 0.08)` — borders
- `--member-accent: rgba(249, 115, 22, 0.1)` — orange active tint
- `--member-accent-strong: rgba(249, 115, 22, 0.2)` — orange hover tint
- `--member-hero-bg: #451a03` — hero card gradient start
- `--member-hero-bg-end: #1c0a00` — hero card gradient end

Active nav state: orange left border (`border-brand-orange`) + orange background tint (`bg-brand-orange/10`).

### Client Record (`/client-pool/[clientId]`)

Case management view for a single TMP client through the 4-phase compliance workflow. Three-zone layout:

- **Zone A (top):** `PhaseProgressBar` — horizontal progress pills showing Phase 0-3 status
- **Zone B (left 2/3):** Mind map — phase sections with `StepCard` grids, phase connectors, and cross-phase support
- **Zone C (right 1/3, sticky):** `StepDetailPanel` — selected step details, form preview or operator checklist, action buttons

Components at `web/app/(member)/client-pool/[clientId]/components/`:
| Component | Description |
|-----------|-------------|
| `PhaseProgressBar.tsx` | Horizontal phase pills with connector lines |
| `StepCard.tsx` | Individual step card (icon, status pill, name, description) |
| `StepDetailPanel.tsx` | Right panel with step details, info grid, action button |
| `FormPreview.tsx` | Form field list with completion checkmarks |
| `OperatorChecklist.tsx` | Numbered checklist for operator steps with time estimate |

Privacy: PII fields gated by `consentGranted` boolean — shows "[Consent required]" when false.

4 phases, 15 steps total:
- Phase 0: Triage & Payment (5 steps)
- Phase 1: ESign 2848 / Review (4 steps)
- Phase 2: Processing / Due Diligence (2 operator steps)
- Phase 3: Results (3 steps)
- Cross-phase: Support Ticket

### Replaced `(app)` route group

The `(member)` route group replaces the previous `(app)` route group. The old `(app)` layout, sidebar (`components/ui/Sidebar.tsx`), and topbar (`components/ui/Topbar.tsx`) are no longer used by any layout but remain in the repo. The old page code is recoverable from git history.

---

## Tools

Reusable domain modules that sit outside the Worker handler but are imported by Worker routes. Each tool is a pure ES module — no I/O, no env access. Callers (Worker routes, scripts) load any template bytes from R2 and pass them in.

### 2848 Generator
- **Location:** `tools/2848/`
- **Source:** Migrated from `JLW-Dev-Coder/2848` (browser HTML → ESM module)
- **Purpose:** Generates filled IRS Form 2848 Page 1 (Power of Attorney) from structured input by stamping text onto the official IRS PDF template with `pdf-lib`
- **Entry point:** `tools/2848/generator.js` — exports `generate2848Pdf(input, templateBytes)` and `buildFilename(input)`
- **Template:** `tools/2848/template/f2848.pdf` — official IRS Form 2848 PDF
- **Used by:** Client-facing eSign flow (TMP), Staff-facing generation (VLP member app Client Record page)
- **Contract:** `contracts/tmp/tmp.tool.2848.v1.json` (created in Prompt 7)
- **Worker route:** `POST /v1/tools/2848/generate` (created in Prompt 7)
- **Dependencies:** `pdf-lib` ^1.17.1 (already in root `package.json`)
- **Build ID:** `2848-align-2026-01-22-h` — bump if IRS reissues the form and coordinates need re-aligning

---

## 23. Canonicals Enforcement (mandatory on every task)

Before writing any file, check whether the file type has a canonical template.
Canonical templates live in `.claude/canonicals/` in every repo. The VLP repo is the primary source. When a canonical is updated in VLP, copy the updated file to all 7 other repos.

| File type | Canonical template | Check before... |
|-----------|-------------------|-----------------|
| CLAUDE.md | canonical-claude.md | Editing any CLAUDE.md |
| Contract JSON | canonical-contract.json | Creating or modifying any contract |
| Contract registry | canonical-contract-registry.json | Adding registry entries |
| index.html (landing) | canonical-index.html | Creating landing pages |
| MARKET.md | canonical-market.md | Editing marketing copy |
| README.md | canonical-readme.md | Editing any README |
| ROLES.md | canonical-roles.md | Editing role definitions |
| SCALE.md | canonical-scale.md | Editing pipeline docs |
| SKILL.md | canonical-skill.md | Editing skill files |
| STYLE.md | canonical-style.md | Editing style guides |
| Workflow docs | canonical-workflow.md | Editing workflow docs |
| wrangler.toml | canonical-wrangler.toml | Editing Worker config |

### Rules
1. If a canonical exists for the file type, read it BEFORE making changes
2. The output must contain every required section listed in the canonical
3. If the canonical defines required keys (e.g., `usedOnPages` in contracts),
   those keys must be present — never omit them
4. If a task would create a new file type not covered by a canonical,
   stop and report to Principal Engineer before proceeding
5. After completing the task, verify the output against the canonical checklist

### Cross-repo canonical source of truth
Canonical templates live in `.claude/canonicals/` in every repo. The VLP repo is the primary source. When a canonical is updated in VLP, copy the updated file to all 7 other repos. The Principal Engineer is responsible for ensuring compliance across all 8 repos.

---

## Deploy Policy

Unless explicitly told otherwise, every task that modifies Worker source
code (workers/src/index.js) or wrangler.toml must end with:

1. git add + commit (descriptive message)
2. git push origin
3. wrangler deploy

Do not wait for permission to deploy. If the prompt included code changes,
deploy is implied. If a task should NOT deploy (e.g., WIP or experimental),
the prompt will say "do not deploy".

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