# README.md — Virtual Launch Pro (VLP)
Last updated: 2026-04-03

**Repo:** virtuallaunch.pro
**Worker API:** api.virtuallaunch.pro
**Frontend:** virtuallaunch.pro

---

## 1. What This Repo Is

The canonical backend hub for all 8 platforms in the VLP ecosystem.

- All backend routes live here (single Cloudflare Worker)
- All contracts live here (versioned JSON schemas)
- All shared infrastructure lives here (auth, billing, tokens, affiliates)
- The VLP web frontend lives under `/web`

Every platform frontend calls `api.virtuallaunch.pro`. No platform owns its own backend.

---

## 2. Platforms

| Platform | Abbrev | Domain |
|----------|--------|--------|
| Virtual Launch Pro | VLP | virtuallaunch.pro |
| Tax Monitor Pro | TMP | taxmonitor.pro |
| Transcript Tax Monitor Pro | TTMP | transcript.taxmonitor.pro |
| Tax Tools Arcade | TTTMP | taxtools.taxmonitor.pro |
| Developers VLP | DVLP | developers.virtuallaunch.pro |
| Games VLP | GVLP | games.virtuallaunch.pro |
| Tax Claim VLP | TCVLP | taxclaim.virtuallaunch.pro |
| Website Lotto VLP | WLVLP | websitelotto.virtuallaunch.pro |

---

## 3. Architecture
Platform frontend (Next.js, Cloudflare Pages)
↓ HTTPS
api.virtuallaunch.pro (Cloudflare Worker)
↓            ↓
R2           D1
(authoritative) (projection)

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router) + Tailwind + `@cloudflare/next-on-pages` |
| Backend | Single Cloudflare Worker — deny-by-default |
| Database | Cloudflare D1 — projection only, never source of truth |
| Storage | Cloudflare R2 — always authoritative |
| Auth | `vlp_session` HttpOnly cookie, Google OAuth, Magic Link, TOTP 2FA |
| Billing | Stripe (hosted + embedded checkout, webhook reconciliation) |
| Affiliates | Stripe Connect Express, 20% flat lifetime commission |

---

## 4. Repo Structure
/
├── .claude/
│   └── CLAUDE.md                      ← authoritative system rules
├── web/                               ← VLP frontend (Next.js)
│   ├── lib/api/client.ts              → API client
│   ├── lib/auth/session.ts            → session management
│   └── middleware.ts                  → auth guard
├── workers/
│   ├── src/index.js                   ← all Worker routes (deny-by-default)
│   └── migrations/                    ← D1 migration files
├── contracts/
│   ├── contract-registry.json         ← master index
│   ├── canonical-contract.json        ← contract template
│   ├── canonical-registry.json        ← registry entry template
│   └── registries/
│       ├── vlp-registry.json
│       ├── tmp-registry.json
│       ├── ttmp-registry.json
│       ├── tttmp-registry.json
│       ├── dvlp-registry.json
│       ├── gvlp-registry.json
│       ├── tcvlp-registry.json
│       └── wlvlp-registry.json
└── wrangler.toml                      ← Worker config and bindings

---

## 5. Key Rules

**Write pipeline (never deviate):**
validate → receipt R2 → canonical R2 → D1 projection → response

**Platform boundaries:**
- Backend logic → VLP Worker only
- Platform repos → frontend only, no new Workers
- Shared record writes → VLP API routes only

**Storage:**
- R2 is always authoritative
- D1 is always a queryable projection

**Session:**
- `vlp_session` HttpOnly cookie only — never localStorage

**Contracts:**
- All 7 sections required: `auth`, `contract`, `delivery`, `effects`, `payload`, `response`, `schema`
- All contracts centralized in this repo
- Never copy contracts into platform repos

---

## 6. Commands

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

---

## 7. Cloudflare Pages Build Config

| Platform | Build Command | Output Dir | Adapter |
|----------|---------------|-----------|---------|
| VLP | `cd web && npm install && npm run pages:build` | `web/.vercel/output/static` | `@cloudflare/next-on-pages` |
| TMP | `npm run build` | `out` | static export |
| TTMP | `npm run cf:build` | `.open-next/assets` | OpenNext |
| TTTMP | `npx @cloudflare/next-on-pages` | `.vercel/output/static` | `@cloudflare/next-on-pages` |
| DVLP | `npm run pages:build` | `.vercel/output/static` | `@cloudflare/next-on-pages` |
| GVLP | `npm run build` | `out` | static export |
| TCVLP | `npm run build` | `out` | static export |
| WLVLP | `npm run build` | `out` | static export |

Do not change these without updating this table and CLAUDE.md section 16.

---

## 8. Deployment

| Service | URL / ID |
|---------|---------|
| Frontend | https://virtuallaunch.pro |
| Worker API | https://api.virtuallaunch.pro |
| D1 | virtuallaunch-pro (id: 079dfd69-dbf4-4070-bc91-51f837021795) |
| R2 | virtuallaunch-pro |
| Cloudflare Account | b14e124b2f5dd7e86dfb1546f9ed6e91 |

Secrets managed via `wrangler secret put` — never committed to the repo.

---

## 9. Current Phase

**Phase 3 — Affiliate Program: COMPLETE (2026-03-30)**

**Phase 4 — Token purchase flow wired to membership gating (next)**

See CLAUDE.md section 7 for full phase plan.

---

## 10. Claude Context

| File | Purpose |
|------|---------|
| `.claude/CLAUDE.md` | Authoritative system rules and constraints |
| `contracts/canonical-contract.json` | Contract template — reference before creating any contract |
| `contracts/canonical-registry.json` | Registry entry template |
| `wrangler.toml` | Worker config, bindings, non-secret env vars |