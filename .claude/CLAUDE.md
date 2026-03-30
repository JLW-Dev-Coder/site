# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Objective (Read This First)

VLP (virtuallaunch.pro) is the canonical hub for all platforms in
this ecosystem. Every other platform — TMP, TTMP, TTTMP, DVLP,
GVLP, TCVLP, WLVLP — has or had its own legacy standalone
Cloudflare Worker. The goal of this project is:

1. Build all backend logic properly inside VLP's single Worker
2. Update each platform's frontend to call VLP's API instead of
   its own Worker
3. Verify each platform works correctly against VLP
4. Delete the legacy Worker from the platform repo and Cloudflare

The legacy Workers are being replaced, not integrated. VLP is the
permanent home for all backend logic.

## Migration Status

Track legacy Worker status here. Update this section as work completes.

| Platform | Legacy Worker Exists | Routes Ported to VLP | Frontend Updated | Worker Deleted |
|---|---|---|---|---|
| TTMP | ✅ Yes | ✅ Complete (24/24) | ✅ Complete | ✅ Deleted |
| TTTMP | ✅ Yes | ✅ Complete (13/13) | 🔄 In Progress | ❌ No |
| TMP | Unknown | Unknown | Unknown | Unknown |
| DVLP | Unknown | Unknown | Unknown | Unknown |
| GVLP | Unknown | Unknown | Unknown | Unknown |
| TCVLP | Unknown | Unknown | Unknown | Unknown |
| WLVLP | Unknown | Unknown | Unknown | Unknown |

## Current Build Phase

**Phase 2: TTMP Transcript Dashboard**
- Phase 2.0: PDF upload route (POST /v1/transcripts/upload) — DONE
- Phase 2.1: VLP architecture review (in progress)
- Phase 2.2: Transcript job history dashboard — NOT STARTED
- Phase 2.3: Individual report display — NOT STARTED
- Phase 2.4: Frontend updated to call VLP API — NOT STARTED
- Phase 2.5: Legacy TTMP Worker deleted — NOT STARTED

**Upcoming Phases:**
- Phase 3: Affiliate program (VLP core feature, ecosystem-wide)
  - Stripe Connect Express accounts
  - Lifetime attribution
  - Cash payouts
  - AFFILIATE_COMMISSION_RATE = 0.20 (flat, all platforms)
- Phase 4: Token purchase flow wired to membership gating
- Phase 5: TMP + DVLP + GVLP membership tiers
- Phase 6: WLVLP marketplace

## Rules For Every Task (Self-Check Before Starting)

Before writing any code, Repo Claude must answer these questions:

1. Does this belong in VLP's Worker or a platform frontend?
   - Backend logic → always VLP Worker
   - UI/pages → platform frontend repo
   - Never build new backend routes in platform repos

2. Is there an existing contract for this route?
   - Check /contracts/registries/ before creating anything new
   - Never duplicate an existing contract

3. Does this route already exist in workers/src/index.js?
   - Grep for the route pattern first
   - Never add a duplicate route

4. Does this change the write pipeline?
   - Order must always be: validate → receipt → R2 canonical → D1 projection
   - Never deviate from this order

5. Am I in the right repo?
   - VLP (virtuallaunch.pro): Worker, contracts, shared infrastructure
   - Platform repos: Frontend only, no new Workers

## Known Legacy TTMP Worker Routes (To Be Ported)

The following routes exist in the legacy TTMP Worker and need
VLP equivalents built or verified:

ALREADY PORTED TO VLP (14 routes):
- GET  /v1/auth/session (existing)
- POST /v1/auth/magic-link/request (existing)
- GET  /v1/auth/magic-link/verify (existing)
- POST /v1/auth/logout (existing)
- GET  /v1/pricing (existing)
- POST /v1/checkout/sessions (existing)
- GET  /v1/checkout/status (existing)
- POST /v1/webhooks/stripe (existing)
- GET  /v1/tokens/balance/{account_id} (existing)
- POST /v1/transcripts/upload (built 2026-03-29)
- POST /v1/tools/transcript-parser (existing)
- GET  /v1/support/tickets/by-account/{account_id} (existing)
- GET  /v1/support/tickets/{ticket_id} (existing)
- PATCH /v1/support/tickets/{ticket_id} (existing)
- POST /v1/support/tickets (existing)

NEEDS VLP EQUIVALENT (10 routes):
- POST /v1/tokens/consume → token consumption logic needed
- POST /v1/tokens/credit → token crediting logic needed
- GET  /v1/transcripts/reports → user report history needed
- GET  /v1/transcripts/purchases → user purchase history needed
- POST /v1/transcripts/report-link → short link creation needed
- GET  /v1/transcripts/report-link → short link resolution needed
- GET  /v1/transcripts/report-data → report payload retrieval needed
- GET  /v1/transcripts/report → report redirect needed
- POST /v1/transcripts/report-email → email report link needed
- POST /v1/transcripts/preview → preview with token consumption needed

DURABLE OBJECT - TokenLedger:
- The legacy TTMP Worker uses a Durable Object (TokenLedger)
  for token balance tracking
- VLP uses /r2/tokens/{account_id}.json as canonical storage
- Migration plan: VLP token system replaces DO ledger
- Do NOT recreate the Durable Object in VLP

---

## Commands

### Frontend (`/web`)

```bash
cd web
npm run dev          # Local dev server (Next.js)
npm run build        # Production build
npm run lint         # ESLint
npm run pages:build  # Build for Cloudflare Pages (@cloudflare/next-on-pages)
```

### Worker (`/workers`)

```bash
wrangler dev                                                # Local Worker dev (with D1 + R2 bindings)
wrangler deploy                                             # Deploy Worker to production
wrangler d1 migrations apply virtuallaunch-pro --remote    # Run D1 migrations
wrangler secret put SECRET_NAME                            # Set a secret
wrangler tail                                               # Stream live Worker logs
```

---

## Architecture

This is a **Cloudflare-first monorepo** for a multi-product SaaS ecosystem. Eight products share a single Worker and D1 database, all owned and distributed through VLP:

| Platform | Abbrev | Role |
|---|---|---|
| **Virtual Launch Pro** | VLP | Core hub — canonical owner of all shared records, auth, billing, booking |
| **Tax Monitor Pro** | TMP | Taxpayer discovery + directory; reads shared records via VLP API |
| **Transcript Tax Monitor** | TTMP | Transcript parsing + diagnostics; token-gated |
| **Tax Tools Arcade** | TTTMP | Tax education games; token-gated |
| **Developers VLP** | DVLP | Freelancer/client matching; Free + $2.99 intro tier |
| **Games VLP** | GVLP | Gamified subscription platform; token-based tiers |
| **Tax Claim VLP** | TCVLP | Auto Form 843 generator; flat $10/mo |
| **Website Lotto VLP** | WLVLP | Canva-site marketplace; voting/bidding/buy-now layer |

**Build dependency order: TTTMP/TCVLP tools → TTMP transcripts → TMP/DVLP/GVLP memberships → VLP + WLVLP distribution**

### Stack

- **Frontend:** Next.js 15 (App Router) + Tailwind + `@cloudflare/next-on-pages`
- **Backend:** Single Cloudflare Worker (`workers/src/index.js`) — 109 routes, deny-by-default (last verified 2026-03-29)
- **Database:** Cloudflare D1 (`DB` binding) — projection only, never source of truth
- **Storage:** Cloudflare R2 (`R2_VIRTUAL_LAUNCH` binding) — always authoritative
- **Auth:** `vlp_session` HttpOnly cookie, Google OAuth, Magic Link, SSO (OIDC + SAML), TOTP 2FA
- **Billing:** Stripe (hosted + embedded checkout, webhook reconciliation)
- **Booking:** Cal.com OAuth + webhook

### Key Files

```
/web/lib/api/client.ts       — API client (fetches from api.virtuallaunch.pro)
/web/lib/auth/session.ts     — getSession() + getSessionToken()
/web/middleware.ts           — Auth guard on 9 dashboard routes (vlp_session cookie)
/workers/src/index.js        — Full Worker: all 96 routes
/workers/migrations/         — 15 D1 migration files (note: duplicate 0002_ prefix, no 0014_)
/contracts/                  — 65 versioned JSON schemas — authoritative, never modify without instruction
/wrangler.toml               — Worker config, bindings, non-secret env vars
```

---

## Core Rules (never violate)

### Write Pipeline

Every mutating request must follow this exact sequence:

```
1. Contract validation (reject if invalid)
2. Receipt written to R2  (immutable event record)
3. Canonical R2 object updated  (source of truth)
4. D1 index updated  (projection only)
5. Response returned
```

R2 is always authoritative. D1 is always a queryable projection.

### Platform Ownership

- **VLP owns** all shared operational records: accounts, billing, bookings, memberships, profiles, support tickets, tokens.
- **TMP, TTMP, TTTMP** may read shared records and project them into their own UX. They **must not write** to shared records directly — all shared writes go through VLP API routes.
- Billing routes (`/v1/billing/*`, `/v1/checkout/*`, `/v1/webhooks/stripe`) are VLP-only.
- Cal.com webhook (`POST /v1/webhooks/cal`) is VLP-only.

### Contracts

Every route is backed by a versioned JSON contract in `/contracts/`. The canonical schema is `/contracts/canonical-contract.json` — follow it exactly.

**File naming:** `contracts/{domain}/{domain}.{action}.v{n}.json`
**Required top-level sections (all 7 must be present):** `auth`, `contract`, `delivery`, `effects`, `payload`, `response`, `schema`

Required fields within each section (per `canonical-contract.json`):

| Section | Required fields |
|---|---|
| `auth` | `required`, `trustClientIdentityFields`, `type` |
| `contract` | `authority`, `governs`, `path`, `source`, `title`, `usedOnPages`, `validation`, `version` |
| `delivery` | `endpoint`, `method`, `receiptKeyPattern`, `receiptSource`, `signature` |
| `effects` | `dedupeKey`, `eventIdFrom`, `writeOrder`, `writes` |
| `payload` | `additionalProperties`, `properties`, `required`, `type` |
| `response` | `deduped`, `error`, `success` |
| `schema` | `name`, `version` |

`contract.path` must match the actual repo file path (e.g. `/contracts/account/account.create.v1.json`).

**Registry:** Every contract must have a corresponding entry in `contracts/contract-registry.json`. The canonical schema for registry entries is `/contracts/canonical-registry.json`. Required entry fields: `authRequired`, `category`, `dedupeKey`, `endpoint`, `id`, `method`, `path`, `receiptKeyPattern`, `receiptSource`, `signatureRequired`, `status`, `usedOnPages`, `version`, `writes`.

- Contracts are repo-local — never copy a VLP contract into TMP/TTMP/TTTMP repos.
- Frontend pages must submit exactly what the contract expects — no invented fields.
- DVLP, GVLP, TCVLP, TMP, TTMP, TTTMP, WLVLP must not define contracts for: billing, memberships, bookings, profiles, support_tickets, tokens — those belong to VLP.

## Contract Management (Federated Model)

### Registry Architecture

All contracts are centralized in the VLP repo with a federated structure:

```
virtuallaunch.pro/contracts/
├── contract-registry.json         # Master index (8 platform refs)
└── registries/
    ├── vlp-registry.json          # VLP contracts
    ├── tmp-registry.json          # TMP contracts
    ├── ttmp-registry.json         # TTMP contracts
    ├── tttmp-registry.json        # TTTMP contracts (form2848, form8821, transcript-parser)
    ├── dvlp-registry.json         # DVLP contracts
    ├── gvlp-registry.json         # GVLP contracts
    ├── tcvlp-registry.json        # TCVLP contracts
    └── wlvlp-registry.json        # WLVLP contracts
```

### Adding a New Contract

**Process:**
1. Determine which platform owns this contract (vlp, tmp, ttmp, tttmp, dvlp, gvlp, tcvlp, wlvlp)
2. Create contract file: `contracts/{platform}/{platform}.{action}.v1.json`
3. Validate contract has all 7 required sections (use canonical-contract.json as template)
4. Add entry to platform registry: `contracts/registries/{platform}-registry.json`
5. Worker auto-loads on next deployment (no master registry edit needed)
6. Add route handler to `workers/src/index.js`
7. Test with `wrangler dev`

**Contract Naming Convention:**
- Platform prefix: `{platform}.{domain}.{action}.v{version}.json`
- Examples:
  - `tttmp.tool.form2848.v1.json`
  - `vlp.auth.google-oauth.v1.json`
  - `tmp.inquiry.create.v1.json`

**Registry Entry Template:**
```json
{
  "id": "{platform}.{action}.v1",
  "path": "/contracts/{platform}/{platform}.{action}.v1.json",
  "endpoint": "/v1/{domain}/{action}",
  "method": "POST|GET|PATCH|DELETE",
  "status": "active",
  "category": "tool|auth|billing|booking|notification",
  "addedDate": "YYYY-MM-DD"
}
```

### Contract Validation Checklist

Before adding a contract to the registry:
- [ ] All 7 sections present (auth, contract, delivery, effects, payload, response, schema)
- [ ] `contract.path` matches actual file path
- [ ] Platform correctly identified in filename
- [ ] Endpoint follows `/v1/{domain}/{action}` pattern
- [ ] Required payload fields documented
- [ ] Response formats defined (success, error, deduped)
- [ ] Receipt key pattern defined
- [ ] Write order specified

### Multi-Repo Coordination

**Backend (Worker + Contracts):**
- All changes happen in `virtuallaunch.pro` repo
- Contracts live in `/contracts/`
- Routes live in `/workers/src/index.js`
- Deploy with `wrangler deploy`

**Frontend (Platform Pages):**
- Switch to the appropriate repo per platform:
  - TTMP pages → `transcript.taxmonitor.pro`
  - TMP pages → `taxmonitor.pro`
  - TTTMP pages → `taxtools.taxmonitor.pro`
  - DVLP pages → `developers.virtuallaunch.pro`
  - GVLP pages → `games.virtuallaunch.pro`
  - TCVLP pages → `taxclaim.virtuallaunch.pro`
  - WLVLP pages → `websitelotto.virtuallaunch.pro`
- Frontend calls Worker API at `https://api.virtuallaunch.pro`

**Contract Ownership:**
- VLP owns: accounts, billing, bookings, memberships, profiles, support_tickets, tokens
- Platform-specific contracts: each platform owns their own domain-specific contracts
- No cross-platform contract copying — all contracts centralized in VLP repo

### CORS + Session

- Worker CORS is locked to `https://virtuallaunch.pro` — no other origin accepted.
- Session is managed exclusively via the `vlp_session` HttpOnly cookie — never LocalStorage or headers.

### Canonical ID Format

```
account_id        = ACCT_{UUID}
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
```

IDs are globally unique and immutable once assigned.

---

## Deployment

```
Frontend:    https://virtuallaunch.pro       (Cloudflare Pages — auto-deploys on push to main)
Worker API:  https://api.virtuallaunch.pro   (wrangler deploy)
D1:          virtuallaunch-pro              (id: 079dfd69-dbf4-4070-bc91-51f837021795)
R2:          virtuallaunch-pro
```

Secrets are managed via `wrangler secret put` — never committed to the repo. See `wrangler.toml` comments for the full secret list.

---

## Phased Build Plan

The four products must be built in dependency order. Without tools, memberships are hollow.

### Phase 1 — TTTMP: Usable Tools (Foundation)
- IRS form autofill tools (2848, 8821)
- Basic transcript parser
- Token deduction on use
- `/api/tools/*` Worker endpoints backed by TTTMP contracts

### Phase 2 — TTMP: Transcript Dashboard (Productization)
- Transcript job submission + result history
- Monitoring dashboard (poll-based, no real-time yet)
- Token balance display

### Phase 3 — VLP: Membership Gating (Monetization)
- Wire existing auth flows to tool access gating
- Token purchase flow via Stripe
- Membership tier enforcement on tool access

### Phase 4 — TMP + DVLP + GVLP (Membership Tiers)
- Tax pro directory (TMP) — taxpayer intake + matching
- Developer matching marketplace (DVLP) — Free + $2.99 intro tier
- Gamified subscriptions (GVLP) — token-based tiers ($9/$19/$39/mo)

### Phase 5 — WLVLP + Distribution (Marketplace)
- Canva site exports served as static content under `/sites/[slug]/` — wrapped with Next.js voting/bidding/buy-now UI layer
- **Do not convert Canva exports to React** — treat them as immutable content, Next.js is the system layer
- Website Lotto public surface: zero PII, CDN-first, voting/bidding calls private Worker only at mutation point

---

## Security Rules

These constraints apply to every route, component, and data access decision in this codebase.

### Data Storage Boundaries

| Store | Allowed | Never store here |
|---|---|---|
| **R2** | Canonical records, receipts, transcripts (TTL-scoped), results | — |
| **D1** | Index projections, queryable metadata | Raw uploaded docs, session tokens |
| **KV** | Feature flags, public catalog metadata, routing config, anonymous counters | Taxpayer names/emails, transcript results, support ticket details, anything PII |

KV is eventually consistent and globally replicated — PII stored there has a large breach blast radius. Keep PII in one canonical server-side layer (R2 + D1).

### Cookie Requirements

Every session cookie must have all three attributes set explicitly:

```
HttpOnly; Secure; SameSite=Lax
```

The `vlp_session` cookie already follows this. Never relax these attributes for any new auth surface.

### Authorization on Every Private Mutation

Auth (knowing who the user is) is not the same as authorization (knowing what they're allowed to do). Every Worker route that mutates data must:

1. Validate the session token
2. Check the account's membership tier / entitlements
3. Verify the account owns the resource being mutated (no IDOR)
4. Reject before any write begins — never after

Server Actions in Next.js are public HTTP endpoints. Apply the same checks there.

### Rate Limiting — Required Endpoints

The following endpoints must have rate limiting applied at the Worker or Cloudflare WAF layer before any new route in these groups ships:

```
POST /v1/auth/magic-link/request     — brute-force / spam
POST /v1/auth/google/start           — OAuth abuse
POST /v1/auth/2fa/challenge/verify   — brute-force
POST /v1/tools/*                     — token consumption abuse
POST /v1/transcripts/*               — token consumption + upload abuse
POST /v1/support/tickets             — spam
POST /v1/uploads/*                   — storage abuse
```

### PII Minimization

- Do not store raw uploaded documents beyond the processing window
- Do not store full transcript text longer than required for the job result
- Store derived results and IDs, not originals, wherever possible
- Website Lotto / Canva public surfaces must contain zero PII — no account data, no client records, no tax data, ever

### Public vs Private Surface Separation

- **Public (Canva / Website Lotto):** static, CDN-first, no auth required for browsing, zero PII
- **Private (VLP/TMP/TTMP/TTTMP app):** authenticated routes only, server-side data access, all mutations through Worker contracts
- Voting and bidding APIs on public surfaces call the private Worker only at the mutation point — they do not expose private data in responses
