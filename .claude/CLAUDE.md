# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- **Backend:** Single Cloudflare Worker (`workers/src/index.js`) — 64 routes, deny-by-default
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
/workers/src/index.js        — Full Worker: all 64 routes
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

### CORS + Session

- Worker CORS is locked to `https://virtuallaunch.pro` — no other origin accepted.
- Session is managed exclusively via the `vlp_session` HttpOnly cookie — never LocalStorage or headers.

### Canonical ID Format

```
account_id      = ACCT_{UUID}
booking_id      = BOOK_YYYYMMDD_{RANDOM}
event_id        = EVT_{UUID}
membership_id   = MEM_{UUID}
professional_id = PRO_{UUID}
ticket_id       = TKT_{UUID}
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
