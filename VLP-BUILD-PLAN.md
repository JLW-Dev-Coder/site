# VLP ECOSYSTEM BUILD PLAN

**Last Updated:** 2026-03-29
**Status:** Phase 1 Complete ✅ | Phase 2 Complete ✅ — Awaiting Audit
**Repo:** virtuallaunch.pro

---

## Executive Summary

**8 Platforms | 5 Build Phases | Dependency-Driven Delivery**

The VLP ecosystem consists of 8 interconnected platforms sharing a single Cloudflare Worker, D1 database, and R2 storage layer. Build order is determined by dependency chains: foundational tools → product layers → distribution channels.

### Build Order (NEVER DEVIATE)
```
Phase 1: TTTMP Tools Foundation     ✅ COMPLETE
Phase 2: TTMP Transcript Dashboard  ✅ COMPLETE (awaiting audit)
Phase 3: VLP Membership Gating      📋 PLANNED
Phase 4: TMP + DVLP + GVLP Tiers   📋 PLANNED
Phase 5: WLVLP + TCVLP Distribution 📋 PLANNED
```

**Critical Constraint:** Without tools (TTTMP), there's nothing to gate (VLP). Without gating (VLP), membership tiers (TMP/DVLP/GVLP) are hollow. Without core platforms, distribution (WLVLP/TCVLP) has nothing to distribute.

---

## Platform Dependency Map

```
FOUNDATION LAYER (Phase 1)
└─ TTTMP (Tax Tools Arcade)
   ├─ Form 2848 Tool ✅
   ├─ Form 8821 Tool ✅
   └─ Transcript Parser ✅

PRODUCT LAYER (Phases 2-3)
├─ TTMP (Transcript Tax Monitor) — productizes transcript parsing
│  └─ Depends on: TTTMP transcript parser
│
└─ VLP (Virtual Launch Pro) — monetization + gating
   └─ Depends on: TTTMP tools exist

MEMBERSHIP LAYER (Phase 4)
├─ TMP (Tax Monitor Pro) — taxpayer directory
│  └─ Depends on: VLP billing, TTTMP/TTMP tools
│
├─ DVLP (Developers VLP) — freelancer matching
│  └─ Depends on: VLP billing, profiles
│
└─ GVLP (Games VLP) — gamified subscriptions
   └─ Depends on: VLP billing, TTTMP tools

DISTRIBUTION LAYER (Phase 5)
├─ WLVLP (Website Lotto) — marketplace
│  └─ Depends on: VLP billing, TMP directory
│
└─ TCVLP (Tax Claim VLP) — Form 843 generator
   └─ Depends on: VLP billing, TMP directory
```

---

## Phase 1: TTTMP Tools Foundation ✅ COMPLETE

### Status: ✅ Done (2026-03-29)

**Goal:** Operational tax tools with token deduction

**Deliverables:**
- ✅ Form 2848 autofill tool (IRS Power of Attorney)
- ✅ Form 8821 autofill tool (Tax Information Authorization)
- ✅ Transcript parser (Account/Return/Wage/Record)
- ✅ Token deduction on use (tax_tool_tokens + transcript_tokens)
- ✅ `tool_sessions` D1 table for usage tracking
- ✅ R2 receipts + canonical storage
- ✅ D1 projections

**Worker Routes:**
- `POST /v1/tools/form2848` ✅
- `POST /v1/tools/form8821` ✅
- `POST /v1/tools/transcript-parser` ✅

**Contracts:**
- `tttmp.tool.form2848.v1` ✅
- `tttmp.tool.form8821.v1` ✅
- `tttmp.tool.transcript-parser.v1` ✅

**Migrations:**
- `0016_tool_sessions_and_transcript_jobs.sql` ✅

**Success Criteria:**
- ✅ All 3 tools accept payloads
- ✅ Tokens deducted correctly
- ✅ Results returned to user
- ✅ Receipts written to R2
- ✅ D1 projections match R2

---

## Phase 2: TTMP Transcript Dashboard ✅ COMPLETE (Awaiting Audit)

### Status: ✅ Implementation Complete (2026-03-29)

**Goal:** Productize transcript parsing with job submission UX

**Dependencies:**
- Phase 1 complete ✅
- `transcript_jobs` table exists ✅ (migration 0016)

### Milestones

#### Milestone 2.1: Job Submission UI ✅
**Deliverable:** User-facing transcript upload page

**Frontend:**
- `web/app/(app)/transcripts/submit/page.tsx` ✅
- Tailwind utility classes (no CSS module needed)

**Features:**
- ✅ JSON file upload (.json only, max 1MB)
- ✅ Token balance display (fetched from `GET /v1/tokens/balance/{account_id}`)
- ✅ Token cost display (1 transcript token)
- ✅ Submit button disabled if balance < 1
- ✅ File preview with JSON pretty-print
- ✅ Redirect to `/transcripts/results/{event_id}` on success
- ✅ Error handling displays worker error messages

**Validation Checklist:**
- [x] Page created at correct path
- [x] Auth middleware applied (`/transcripts/*` + `/tools/*`)
- [x] File upload validates .json + 1MB limit
- [x] Token balance fetched before submit
- [x] Submit disabled if balance < 1
- [x] Success → redirect to results page
- [x] Error handling displays worker error messages
- [x] Uses Tailwind with design system colors (no hardcoded colors)

---

#### Milestone 2.2: Result History Dashboard ✅
**Deliverable:** List all transcript jobs for logged-in user + individual detail view

**Frontend:**
- `web/app/(app)/transcripts/results/page.tsx` ✅ (history list)
- `web/app/(app)/transcripts/results/[event_id]/page.tsx` ✅ (detail view)

**Worker (NEW route):**
- `GET /v1/tools/transcript-parser/history/:account_id` ✅
- Uses existing `GET /v1/transcripts/jobs/:job_id` for detail

**Contract + Registry:**
- `contracts/tttmp/tttmp.tool.transcript-parser-history.v1.json` ✅
- Registry entry added ✅

**Features:**
- ✅ Job history list with status badges
- ✅ Poll every 10s if any status = "processing"
- ✅ Link to detail page for each job
- ✅ Individual result detail with parsed output (TINs, dates, amounts, cycles, balance)
- ✅ Auto-poll on detail page while status = "processing"

**Validation Checklist:**
- [x] Worker route created: `GET /v1/tools/transcript-parser/history/:account_id`
- [x] Contract created with all 7 sections
- [x] Registry entry added
- [x] Frontend history page created
- [x] Frontend detail page created
- [x] Auth middleware applied (via `/transcripts/*`)
- [x] History fetched on page load
- [x] Poll every 10s for processing jobs
- [x] Links work to detail pages
- [x] Account ownership verified (session.account_id must match URL param)

---

#### Milestone 2.3: Monitoring Panel + Token Balance ✅
**Deliverable:** Dashboard hub with monitoring and token balance

**Frontend:**
- `web/app/(app)/transcripts/page.tsx` ✅ (rewritten as dashboard hub)

**Features:**
- ✅ Token balance card (transcript tokens)
- ✅ Completed jobs count
- ✅ Processing jobs count with auto-refresh indicator
- ✅ Recent jobs list (last 5) with status badges
- ✅ Auto-poll every 10s when processing jobs exist
- ✅ Quick links to submit and full history

**Validation Checklist:**
- [x] Dashboard hub page at `/transcripts`
- [x] Token balance displayed
- [x] Job counts displayed (completed/processing)
- [x] Recent jobs list with links
- [x] Auto-poll for processing jobs
- [x] "New Submission" CTA

---

### Phase 2 Complete When:
- [x] User can submit transcript
- [x] User can view submission history
- [x] User can view individual result details
- [x] Token balance displayed before submission
- [x] Poll-based monitoring for processing jobs
- [x] Auth middleware protects all transcript routes

**Deliverables:** 4 frontend pages, 1 new Worker route, 1 new contract, 2 updated files (middleware, API client)

---

## Phase 3: VLP Membership Gating 📋 PLANNED

### Status: 📋 Not Started

**Goal:** Monetization layer — auth flows gate tool access

**Dependencies:**
- Phase 1 complete ✅
- Stripe integration (already exists in worker)
- Auth system (already exists)

### Key Components

#### 3.1: Token Purchase Flow
**What:** User buys token packs via Stripe

**Worker Routes (already exist, may need updates):**
- `POST /v1/billing/tokens/purchase`
- `POST /v1/checkout/sessions`

**Frontend (NEW):**
- `web/app/app/tokens/purchase/page.tsx`
- Display available packs (30-pack $9, 80-pack $19, 200-pack $39)
- Launch Stripe checkout
- Redirect to success page

**Validation:**
- [ ] Purchase flow launches Stripe checkout
- [ ] Webhook updates token balance in R2
- [ ] D1 projection updated
- [ ] User redirected to success page

---

#### 3.2: Membership Tier Enforcement
**What:** Tool routes check membership tier before execution

**Changes Needed:**
- Update Form 2848/8821/Transcript Parser routes
- Check membership tier from `GET /v1/memberships/by-account/{account_id}`
- Reject if tier doesn't include tool access

**Logic:**
```javascript
// In each tool route, after session validation:
const membership = await getMembership(session.account_id, env);
const tier = membership.plan; // 'free' | 'starter' | 'scale' | 'advanced'

// Form tools require any paid tier
if (toolName === 'form2848' || toolName === 'form8821') {
  if (tier === 'free') {
    return errorResponse('UPGRADE_REQUIRED', 'Form tools require a paid membership', 402);
  }
}

// Transcript parser requires starter+ tier
if (toolName === 'transcript_parser') {
  if (tier === 'free') {
    return errorResponse('UPGRADE_REQUIRED', 'Transcript parsing requires Starter tier or higher', 402);
  }
}
```

**Validation:**
- [ ] Free tier blocked from form tools
- [ ] Free tier blocked from transcript parser
- [ ] Paid tiers have access
- [ ] Error messages are user-friendly
- [ ] Upgrade CTA displayed in error response

---

#### 3.3: Monthly Token Allocations
**What:** Cron job grants monthly tokens based on membership tier

**New Worker Route (cron-triggered):**
- `POST /v1/cron/monthly-token-grant`
- Runs 1st of each month
- Queries all active memberships
- Grants tokens per tier:
  - Starter: 30 tax_tool + 30 transcript
  - Scale: 120 tax_tool + 100 transcript
  - Advanced: 300 tax_tool + 250 transcript

**Validation:**
- [ ] Cron job runs monthly
- [ ] Tokens granted to all active paid accounts
- [ ] R2 token balances updated
- [ ] D1 projections updated
- [ ] Receipt written for each grant

---

### Phase 3 Complete When:
- [ ] Users can purchase token packs
- [ ] Tool routes enforce tier requirements
- [ ] Monthly token grants work
- [ ] Upgrade prompts appear for free users
- [ ] Stripe webhook reconciliation working

**Estimated Deliverables:** 1 frontend page, 1 cron route, updates to 3 existing tool routes

---

## Phase 4: TMP + DVLP + GVLP Tiers 📋 PLANNED

### Status: 📋 Not Started

**Goal:** Directory + matching platforms with multi-tier plans

**Dependencies:**
- Phase 3 complete (billing gating works)
- Phase 1 complete (tools exist)

### 4.1: TMP (Tax Monitor Pro)

**Unique Challenge:** **TWO separate plan structures**

#### TMP Plan I: Core Access (Free / $9 / $19 / $39)
**Focus:** Tool access + token allocations

**Features:**
- Directory profile
- Messaging
- Token allocations (tax_tool + transcript)
- Support tickets

**Frontend:**
- `web/app/tmp/pricing/page.tsx`
- Display 4 tiers
- Stripe checkout for paid tiers

---

#### TMP Plan II: Monitoring + Core (Bronze $275 / Silver $325 / Gold $425 / Snapshot $425 / MFJ $79)
**Focus:** IRS transcript monitoring service

**Features:**
- Everything from Plan I
- Weekly transcript monitoring (6-12 weeks depending on tier)
- Automated status checks
- Alert notifications

**Technical Implementation:**
- Separate Stripe product IDs for Plan I vs Plan II
- Monitoring cron job (weekly):
  - `POST /v1/cron/transcript-monitoring`
  - Queries all Plan II subscribers
  - Fetches latest transcripts
  - Compares to previous week
  - Sends notifications on changes

**Challenge:** A user can have BOTH Plan I + Plan II simultaneously
- Plan I subscription → token allocations
- Plan II subscription → monitoring service
- Need to handle dual subscriptions in billing logic

**Validation:**
- [ ] Plan I tiers display correctly
- [ ] Plan II tiers display correctly
- [ ] User can subscribe to both independently
- [ ] Token allocations work from Plan I
- [ ] Monitoring works from Plan II
- [ ] Cron job checks only Plan II subscribers
- [ ] MFJ add-on applies correctly

---

### 4.2: DVLP (Developers VLP)

**Plan Structure:** Free / $2.99/mo

**Features:**
- Developer directory profile
- Client matching
- Project browsing
- Messaging
- Profile optimization (paid tier only)

**Frontend:**
- `web/app/dvlp/pricing/page.tsx`
- `web/app/dvlp/directory/page.tsx` (public)
- `web/app/app/dvlp/profile/page.tsx` (authenticated)

**Worker Routes (NEW):**
- `GET /v1/dvlp/directory` (list developers)
- `GET /v1/dvlp/profile/{professional_id}`
- `PATCH /v1/dvlp/profile/{professional_id}`

**Validation:**
- [ ] Directory lists all developers
- [ ] Free tier has basic profile
- [ ] Paid tier gets profile optimization
- [ ] Messaging works between developers and clients

---

### 4.3: GVLP (Games VLP)

**Plan Structure:** Free / $9 / $19 / $39

**Features:**
- Game access (1 / 3 / 5 / all games)
- Token allocations (50 / 500 / 1500 / 750)
- Game analytics

**Frontend:**
- `web/app/gvlp/pricing/page.tsx`
- `web/app/app/gvlp/games/page.tsx`

**Worker Routes (NEW):**
- `GET /v1/gvlp/games` (list available games)
- `POST /v1/gvlp/games/{game_id}/play` (launch game, deduct token)

**Validation:**
- [ ] Game access gated by tier
- [ ] Token deduction on game play
- [ ] Analytics track usage

---

### Phase 4 Complete When:
- [ ] TMP Plan I + Plan II both working
- [ ] DVLP directory + matching functional
- [ ] GVLP games gated by tier
- [ ] All pricing pages deployed
- [ ] Stripe subscriptions for all 3 platforms

**Estimated Deliverables:** 6 pricing pages, 3 directories, 8+ new Worker routes, 12+ contracts

---

## Phase 5: WLVLP + TCVLP Distribution 📋 PLANNED

### Status: 📋 Not Started

**Goal:** Marketplace + lead generation channels

**Dependencies:**
- Phase 4 complete (directories exist)
- Phase 3 complete (billing works)

### 5.1: WLVLP (Website Lotto VLP)

**Plan Structure:** Free / $99/mo

**Features:**
- Public voting on Canva site exports
- Bidding system (paid tier)
- Buy-now instant claim
- Reward perks (tax tool tokens for votes)

**Critical Constraint:** **Zero PII on public surface**
- Canva exports served as static content
- No auth required for browsing/voting
- Voting API calls private Worker only at mutation point
- No account data, client records, or tax data ever exposed

**Architecture:**
```
/sites/[slug]/               ← Static Canva export (HTML/CSS/assets)
/api/vote                    ← Private Worker endpoint (authenticated)
/api/bid                     ← Private Worker endpoint (authenticated)
/api/buy                     ← Stripe checkout (authenticated)
```

**Frontend:**
- `web/app/wlvlp/marketplace/page.tsx` (public listing)
- `web/app/wlvlp/sites/[slug]/page.tsx` (Next.js wrapper around Canva export)

**Worker Routes (NEW):**
- `GET /v1/wlvlp/sites` (list marketplace)
- `POST /v1/wlvlp/vote` (submit vote, grant tokens)
- `POST /v1/wlvlp/bid` (submit bid)
- `POST /v1/wlvlp/buy` (instant purchase)

**Validation:**
- [ ] Public can browse without auth
- [ ] Canva exports render correctly
- [ ] Voting requires auth
- [ ] Token rewards granted for votes
- [ ] Bidding works for paid tier
- [ ] Buy-now triggers Stripe checkout
- [ ] Zero PII in public HTML

---

### 5.2: TCVLP (Tax Claim VLP)

**Plan Structure:** $10/mo flat

**Features:**
- Auto Form 843 generator
- Fully branded pages (logo + colors)
- IRS mailing instructions (per state)
- Mobile responsive + print-ready
- Unlimited client access

**Frontend:**
- `web/app/tcvlp/pricing/page.tsx`
- `web/app/app/tcvlp/form843/page.tsx` (authenticated)

**Worker Routes (NEW):**
- `POST /v1/tcvlp/form843/generate`
- Uses similar logic to Form 2848/8821
- No token deduction (flat monthly fee)

**Validation:**
- [ ] Form 843 generation works
- [ ] Branded pages render correctly
- [ ] State-specific mailing instructions display
- [ ] Mobile responsive
- [ ] Print-ready output

---

### Phase 5 Complete When:
- [ ] WLVLP marketplace live
- [ ] Voting/bidding/buying works
- [ ] TCVLP Form 843 generator live
- [ ] Zero PII on WLVLP public surface
- [ ] All pricing pages deployed

**Estimated Deliverables:** 3 frontend pages, 6+ new Worker routes, marketplace static content system

---

## Cross-Cutting Concerns

### Shared Records (VLP-Owned)
These records are NEVER written directly by TMP/TTMP/TTTMP/DVLP/GVLP/TCVLP/WLVLP:
- accounts
- billing_customers
- billing_subscriptions
- memberships
- profiles
- support_tickets
- tokens

All platforms READ these via VLP API routes. All WRITES go through VLP.

### Contract Discipline
- Every route needs a contract
- Every contract needs a registry entry
- All 7 sections required (auth, contract, delivery, effects, payload, response, schema)
- No contract copying between repos
- Registry must stay in sync

### Migration Discipline
- D1 migrations numbered sequentially
- Never skip numbers
- Never reuse numbers
- Test locally before production
- Always include indexes

### Testing Strategy
- Phase 1: Manual testing (tools work)
- Phase 2: Manual testing (dashboard UX)
- Phase 3: Stripe test mode + manual
- Phase 4: Multi-tier manual testing
- Phase 5: Public surface security audit

---

## Repo Claude Integration

### Completion Tracking
Repo Claude should update this file after each milestone merges:

**Format:**
```markdown
#### Milestone X.Y: [Name]
Status: ✅ Complete (YYYY-MM-DD)
PR: #NN
Verified by: [auditor name]
```

### Phase Completion
When all milestones in a phase complete:
```markdown
## Phase N: [Name] ✅ COMPLETE
Status: ✅ Done (YYYY-MM-DD)
```

### Self-Check Protocol
Before marking complete, Repo Claude verifies:
- [ ] All milestones in phase show ✅
- [ ] All contracts in registry
- [ ] All migrations applied
- [ ] All routes tested
- [ ] No breaking changes to existing routes

---

## Timeline Estimates

**Phase 1:** ✅ Complete (3 PRs, 1 week)  
**Phase 2:** 3 milestones × 1-2 days = 5 days  
**Phase 3:** 3 components × 2 days = 6 days  
**Phase 4:** 3 platforms × 5 days = 15 days  
**Phase 5:** 2 platforms × 5 days = 10 days  

**Total:** ~6 weeks for full ecosystem (assuming 1 developer, no blockers)

---

## Success Metrics

### Phase 1 (TTTMP)
- 3 tools operational
- Token deduction working
- Receipts in R2

### Phase 2 (TTMP)
- Users can submit transcripts
- Results displayed
- History tracked

### Phase 3 (VLP)
- Users can buy tokens
- Tiers enforced
- Monthly grants work

### Phase 4 (TMP/DVLP/GVLP)
- 3 directories live
- Multi-tier billing works
- TMP dual-plan structure works

### Phase 5 (WLVLP/TCVLP)
- Marketplace live
- Form 843 generator works
- Zero PII on public surface

---

## Appendix: Current State

### Completed PRs
| PR # | Phase | Milestone | Status | Date | Notes |
|------|-------|-----------|--------|------|-------|
| #1 | — | Cloudflare Config | Closed | — | Automated bot, superseded |
| #2 | 1 | Form 2848 (Initial) | Closed | — | Failed audit, superseded by #3 |
| #3 | 1 | Form 2848 Fix | Merged | 2026-03-29 | CODEX-aligned |
| #4 | 1 | Form 2848 & 8821 Contracts | Merged | 2026-03-29 | Retroactive contracts |
| #5 | 1 | Transcript Parser (Initial) | Not Created | — | Wrong target, never submitted |
| #6 | 1 | Transcript Parser (Attempt 2) | Not Created | — | Wrong target, never submitted |
| #7 | 1 | Wrong Target (TTMP jobs) | Closed | — | Modified wrong route |
| #8 | 1 | Transcript Parser (Correct) | Pending Merge | 2026-03-29 | ✅ Audit passed |

### Database State
- ✅ Migrations 0001-0016 applied
- ✅ Migration 0013 fixed (manual INSERT)
- ✅ `tool_sessions` table exists
- ✅ `transcript_jobs` table exists
- ✅ `tokens` table exists

### Worker State
- ✅ Form 2848 route operational
- ✅ Form 8821 route operational
- ✅ Transcript parser route operational (pending merge)
- ✅ Auth routes operational
- ✅ Stripe webhook operational

### Contract State
- ✅ 3 TTTMP contracts in registry
- ✅ All contracts have 7 sections
- ✅ Registry in sync

---

## Registry Architecture

### Federated Model (Implemented 2026-03-29)

**Structure:**
```
contracts/
├── contract-registry.json         (master index, 8 platform refs)
└── registries/
    ├── vlp-registry.json          (64 VLP contracts)
    ├── tmp-registry.json          (TMP contracts — Phase 4)
    ├── ttmp-registry.json         (2 TTMP contracts)
    ├── tttmp-registry.json        (4 TTTMP contracts)
    ├── dvlp-registry.json         (DVLP contracts — Phase 4)
    ├── gvlp-registry.json         (GVLP contracts — Phase 4)
    ├── tcvlp-registry.json        (TCVLP contracts — Phase 5)
    └── wlvlp-registry.json        (WLVLP contracts — Phase 5)
```

**Benefits:**
- Manageable file sizes (10-20 contracts per platform max)
- Parallel development without merge conflicts
- Clear ownership boundaries per platform team
- Single source of truth maintained via master index

**Adding a Contract:**
1. Create contract file in `/contracts/{platform}/`
2. Add entry to `/contracts/registries/{platform}-registry.json`
3. Worker auto-loads on next deployment
4. No changes to master registry needed

**Migration Completed:** ✅ 2026-03-29
**Worker Support:** ✅ `workers/src/helpers/contract-loader.js`

### Contract Counts (as of 2026-03-29)
| Platform | Contracts | Status |
|----------|-----------|--------|
| VLP | 64 (1 deprecated) | Active |
| TTTMP | 4 | Active |
| TTMP | 2 | Active |
| TMP | 0 | Phase 4 |
| DVLP | 0 | Phase 4 |
| GVLP | 0 | Phase 4 |
| TCVLP | 0 | Phase 5 |
| WLVLP | 0 | Phase 5 |
| **Total** | **71** | |

### Milestone Completion Template
```markdown
#### Milestone X.Y: [Name]
Status: ✅ Complete (YYYY-MM-DD)
Contracts Added: [list registry files updated]
Worker Routes: [list endpoints added]
Frontend Pages: [list pages added]
Verified by: [auditor name]
```

---

**END OF BUILD PLAN**
