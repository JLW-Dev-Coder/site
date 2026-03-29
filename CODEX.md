# CODEX.md — Build Orchestration Guide

**Purpose:** This document orchestrates PR-driven development for the VLP ecosystem when Claude.ai repo access is unavailable. It provides complete prompts, validation checklists, and audit procedures for each build phase.

**Last Updated:** 2026-03-28  
**Status:** Active — Phase 1 (TTTMP Tools Foundation)  
**Current PR Tracking:** See [PR Log](#pr-log) below

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Build Phase Roadmap](#build-phase-roadmap)
3. [PR Workflow](#pr-workflow)
4. [Phase 1: TTTMP Tools Foundation](#phase-1-tttmp-tools-foundation)
5. [Phase 2: TTMP Transcript Dashboard](#phase-2-ttmp-transcript-dashboard)
6. [Phase 3: VLP Membership Gating](#phase-3-vlp-membership-gating)
7. [Phase 4: TMP + DVLP + GVLP Tiers](#phase-4-tmp--dvlp--gvlp-tiers)
8. [Phase 5: WLVLP Distribution](#phase-5-wlvlp-distribution)
9. [Contract Templates](#contract-templates)
10. [Audit Checklists](#audit-checklists)
11. [PR Log](#pr-log)

---

## Quick Reference

### Repository Structure
```
/
├── web/                      # Next.js 15 frontend (Cloudflare Pages)
│   ├── app/                  # App Router pages
│   ├── components/           # Shared React components
│   ├── lib/                  # Utilities, API clients, auth
│   └── middleware.ts         # Auth guard (9 protected routes)
├── workers/                  # Cloudflare Worker (64 routes)
│   ├── src/index.js          # Single Worker entry point
│   ├── migrations/           # D1 migrations (15 files)
│   └── wrangler.toml         # Bindings, env vars
└── contracts/                # 65 versioned JSON schemas
    ├── canonical-contract.json
    ├── canonical-registry.json
    └── contract-registry.json
```

### Core Constraints (Never Violate)

1. **Write Pipeline:** Contract validation → R2 receipt → R2 canonical → D1 index → Response
2. **R2 is authoritative:** D1 is a projection only
3. **VLP owns shared records:** accounts, billing, bookings, memberships, profiles, support_tickets, tokens
4. **Platform isolation:** TMP/TTMP/TTTMP read shared records via VLP API, never write directly
5. **Contract integrity:** Every contract must have all 7 sections (auth, contract, delivery, effects, payload, response, schema)
6. **Registry sync:** Every contract must have a matching entry in `contract-registry.json`
7. **Session security:** `vlp_session` HttpOnly cookie only — never LocalStorage, never headers
8. **CORS lock:** `https://virtuallaunch.pro` only

### ID Format Reference
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
job_id            = JOB_{UUID}
membership_id     = MEM_{UUID}
ticket_id         = TKT_{UUID}
```

---

## Build Phase Roadmap

**Dependency Chain:** TTTMP tools → TTMP transcripts → TMP/DVLP/GVLP memberships → VLP + WLVLP distribution

### Phase 1: TTTMP Tools Foundation (Current)
**Goal:** Usable tax tools with token deduction  
**Deliverables:**
- Form 2848 autofill tool
- Form 8821 autofill tool
- Basic transcript parser (JSON → structured output)
- Token deduction on tool use
- `/api/tools/*` Worker endpoints

**Success Criteria:**
- [ ] Tool submission accepts JSON payload
- [ ] Token balance checked before execution
- [ ] Token deducted on successful use
- [ ] Result returned to user
- [ ] Receipt written to R2
- [ ] No PII stored beyond processing window

### Phase 2: TTMP Transcript Dashboard
**Goal:** Productize transcript parsing  
**Deliverables:**
- Transcript job submission UI
- Result history dashboard
- Monitoring panel (poll-based)
- Token balance display

### Phase 3: VLP Membership Gating
**Goal:** Monetization layer  
**Deliverables:**
- Auth flows → tool access gating
- Token purchase via Stripe
- Tier enforcement on tool routes

### Phase 4: TMP + DVLP + GVLP Tiers
**Goal:** Directory + matching platforms  
**Deliverables:**
- Tax pro directory (TMP)
- Developer marketplace (DVLP)
- Gamified subscriptions (GVLP)

### Phase 5: WLVLP Distribution
**Goal:** Website marketplace  
**Deliverables:**
- Canva site exports as static content
- Voting/bidding/buy-now layer
- Zero PII on public surface

---

## PR Workflow

### 1. Start a New PR

Use this prompt structure for every PR:

```
CONTEXT:
- Repository: [VLP/TMP/TTMP/TTTMP]
- Phase: [1-5]
- Milestone: [specific deliverable]
- Related contracts: [list contract files]
- Depends on: [previous PR numbers, if any]

TASK:
[Specific, bounded task description — avoid "implement everything"]

CONSTRAINTS:
- Follow Write Pipeline (contract → receipt → canonical → index → response)
- All contracts must have 7 sections
- Update contract-registry.json if adding/modifying contracts
- R2 is authoritative, D1 is projection
- No PII in KV or beyond TTL in R2
- Session via vlp_session HttpOnly cookie only
- CORS locked to https://virtuallaunch.pro

FILES TO MODIFY:
[List expected files — contracts, Worker routes, migrations, frontend pages]

VALIDATION CHECKLIST:
[Copy from relevant phase section below]

AUDIT CHECKLIST:
[Copy from Audit Checklists section below]
```

### 2. Submit PR

Create the PR with:
- **Title:** `[Phase N] Milestone: Brief description`
- **Body:** Full prompt from step 1
- **Labels:** `phase-N`, `needs-audit`

### 3. Audit the PR

Before merging, run the [Audit Checklists](#audit-checklists) below. Post audit results as a PR comment.

### 4. Merge & Track

After passing audit:
1. Merge PR
2. Log in [PR Log](#pr-log)
3. Update phase status if milestone complete

---

## Phase 1: TTTMP Tools Foundation

### Milestone 1.1: Form 2848 Tool

**Prompt:**
```
CONTEXT:
- Repository: VLP (workers/src/index.js)
- Phase: 1 (TTTMP Tools Foundation)
- Milestone: Form 2848 autofill tool
- Related contracts: contracts/tttmp/tttmp.tool.form2848.v1.json (to be created)

TASK:
Create a Worker route that accepts Form 2848 field data, validates against contract schema, deducts 1 token from the user's balance, generates a filled PDF, writes a receipt to R2, and returns the PDF URL.

CONSTRAINTS:
- Follow Write Pipeline: contract validation → R2 receipt → token deduction → PDF generation → response
- Token check BEFORE any processing
- Receipt key pattern: /r2/receipts/tttmp/{account_id}/{event_id}.json
- Canonical token balance: /r2/tokens/{account_id}.json
- D1 tokens table is projection only — update after R2 write
- No PII stored beyond 30-day TTL (set TTL on PDF in R2)
- Session required: validate vlp_session cookie
- Rate limit: 10 requests/minute per account (add to Worker route)

FILES TO MODIFY:
1. contracts/tttmp/tttmp.tool.form2848.v1.json (create)
2. contracts/contract-registry.json (add entry)
3. workers/src/index.js (add POST /v1/tools/form2848 route)
4. workers/migrations/0016_add_tool_usage_table.sql (if needed)

CONTRACT SCHEMA:
{
  "auth": {
    "required": true,
    "type": "session",
    "trustClientIdentityFields": false
  },
  "contract": {
    "authority": "TTTMP",
    "governs": "Tax tool execution — Form 2848",
    "path": "/contracts/tttmp/tttmp.tool.form2848.v1.json",
    "source": "tttmp",
    "title": "TTTMP Tool: Form 2848 Execution",
    "usedOnPages": ["/app/tools/form2848"],
    "validation": "Validates Form 2848 field data, checks token balance, deducts token, generates PDF",
    "version": "1.0"
  },
  "delivery": {
    "endpoint": "/v1/tools/form2848",
    "method": "POST",
    "receiptKeyPattern": "/receipts/tttmp/{account_id}/{event_id}.json",
    "receiptSource": "R2_VIRTUAL_LAUNCH",
    "signature": "TTTMP_TOOL_FORM2848_EXECUTED"
  },
  "effects": {
    "dedupeKey": "{account_id}:{form_data_hash}",
    "eventIdFrom": "server",
    "writeOrder": ["receipt", "token_deduction", "pdf_generation", "d1_index"],
    "writes": [
      {
        "target": "R2",
        "key": "/receipts/tttmp/{account_id}/{event_id}.json",
        "content": "Full event payload + timestamp"
      },
      {
        "target": "R2",
        "key": "/tokens/{account_id}.json",
        "content": "Updated token balance (decrement tax_tool_tokens by 1)"
      },
      {
        "target": "R2",
        "key": "/tttmp/tool_results/{account_id}/{event_id}.pdf",
        "content": "Generated Form 2848 PDF",
        "ttl": 2592000
      },
      {
        "target": "D1",
        "table": "tokens",
        "content": "Projection of R2 token balance"
      },
      {
        "target": "D1",
        "table": "tttmp_tool_usage",
        "content": "Tool execution metadata for queryability"
      }
    ]
  },
  "payload": {
    "type": "object",
    "required": ["account_id", "form_data"],
    "properties": {
      "account_id": {
        "type": "string",
        "pattern": "^ACCT_[a-f0-9-]{36}$"
      },
      "form_data": {
        "type": "object",
        "required": ["taxpayer_name", "taxpayer_ssn", "representative_name"],
        "properties": {
          "taxpayer_name": { "type": "string", "minLength": 1 },
          "taxpayer_ssn": { "type": "string", "pattern": "^\\d{3}-\\d{2}-\\d{4}$" },
          "representative_name": { "type": "string", "minLength": 1 },
          "representative_caf": { "type": "string" },
          "tax_matters": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "additionalProperties": false
  },
  "response": {
    "success": {
      "pdf_url": "https://r2.virtuallaunch.pro/tttmp/tool_results/{account_id}/{event_id}.pdf",
      "tokens_remaining": 15,
      "event_id": "EVT_..."
    },
    "error": {
      "code": "INSUFFICIENT_TOKENS | INVALID_PAYLOAD | RATE_LIMIT_EXCEEDED",
      "message": "Human-readable error"
    },
    "deduped": {
      "message": "Duplicate request detected — returning cached result",
      "original_event_id": "EVT_..."
    }
  },
  "schema": {
    "name": "tttmp.tool.form2848.v1",
    "version": "1.0"
  }
}

VALIDATION CHECKLIST:
- [ ] Contract has all 7 sections (auth, contract, delivery, effects, payload, response, schema)
- [ ] contract.path matches actual file path
- [ ] Contract added to contract-registry.json with all required fields
- [ ] Worker route validates session before any processing
- [ ] Token balance checked BEFORE deduction
- [ ] Token deduction writes to R2 first, then D1
- [ ] Receipt written before PDF generation
- [ ] PDF stored with 30-day TTL
- [ ] Rate limit applied (10/min per account)
- [ ] Error responses follow contract.response.error schema
- [ ] Dedupe logic checks dedupeKey from contract.effects
```

**Validation Checklist (Milestone 1.1):**
- [ ] Contract created: `contracts/tttmp/tttmp.tool.form2848.v1.json`
- [ ] Contract has all 7 sections
- [ ] `contract.path` = `/contracts/tttmp/tttmp.tool.form2848.v1.json`
- [ ] Registry entry added with all required fields
- [ ] Worker route: `POST /v1/tools/form2848` exists
- [ ] Session validation at route entry
- [ ] Token check before processing
- [ ] Write pipeline order: receipt → token deduction → PDF → D1
- [ ] PDF TTL set to 2592000 (30 days)
- [ ] Rate limit: 10 req/min per account
- [ ] Dedupe logic uses `{account_id}:{form_data_hash}`
- [ ] Error responses match contract schema

### Milestone 1.2: Form 8821 Tool

**Prompt:**
```
CONTEXT:
- Repository: VLP (workers/src/index.js)
- Phase: 1 (TTTMP Tools Foundation)
- Milestone: Form 8821 autofill tool
- Related contracts: contracts/tttmp/tttmp.tool.form8821.v1.json (to be created)
- Depends on: Milestone 1.1 (Form 2848 tool pattern established)

TASK:
Create a Worker route for Form 8821 following the exact pattern from Milestone 1.1. Accept field data, validate, check tokens, deduct, generate PDF, write receipt, return URL.

CONSTRAINTS:
- Reuse Write Pipeline from Milestone 1.1
- Token cost: 1 token
- Receipt key: /r2/receipts/tttmp/{account_id}/{event_id}.json
- PDF TTL: 30 days
- Rate limit: 10 req/min per account

FILES TO MODIFY:
1. contracts/tttmp/tttmp.tool.form8821.v1.json (create)
2. contracts/contract-registry.json (add entry)
3. workers/src/index.js (add POST /v1/tools/form8821 route)

CONTRACT SCHEMA:
[Copy structure from Milestone 1.1, change:
- contract.title → "TTTMP Tool: Form 8821 Execution"
- contract.governs → "Tax tool execution — Form 8821"
- delivery.endpoint → "/v1/tools/form8821"
- delivery.signature → "TTTMP_TOOL_FORM8821_EXECUTED"
- payload.properties.form_data.required → ["taxpayer_name", "taxpayer_ssn", "appointee_name"]
- schema.name → "tttmp.tool.form8821.v1"
]

VALIDATION CHECKLIST:
[Copy from Milestone 1.1, update endpoint to /v1/tools/form8821]
```

### Milestone 1.3: Basic Transcript Parser

**Prompt:**
```
CONTEXT:
- Repository: VLP (workers/src/index.js)
- Phase: 1 (TTTMP Tools Foundation)
- Milestone: Basic transcript parser (JSON → structured output)
- Related contracts: contracts/tttmp/tttmp.tool.transcript-parser.v1.json (to be created)
- Depends on: Milestones 1.1, 1.2 (tool execution pattern established)

TASK:
Create a Worker route that accepts IRS transcript JSON (Account Transcript format), parses transaction codes, extracts key dates/amounts, returns structured output, deducts 1 transcript token.

CONSTRAINTS:
- Token type: transcript_tokens (not tax_tool_tokens)
- Token cost: 1 transcript token
- Receipt key: /r2/receipts/tttmp/{account_id}/{event_id}.json
- Result stored: /r2/tttmp/transcript_results/{account_id}/{event_id}.json (30-day TTL)
- Rate limit: 5 req/min per account (transcript parsing is heavier)
- No PII stored beyond TTL — redact SSN/names in stored result

FILES TO MODIFY:
1. contracts/tttmp/tttmp.tool.transcript-parser.v1.json (create)
2. contracts/contract-registry.json (add entry)
3. workers/src/index.js (add POST /v1/tools/transcript-parser route)
4. workers/migrations/0017_add_transcript_usage_table.sql (if needed)

CONTRACT SCHEMA:
{
  "auth": {
    "required": true,
    "type": "session",
    "trustClientIdentityFields": false
  },
  "contract": {
    "authority": "TTTMP",
    "governs": "Transcript parsing tool execution",
    "path": "/contracts/tttmp/tttmp.tool.transcript-parser.v1.json",
    "source": "tttmp",
    "title": "TTTMP Tool: Transcript Parser Execution",
    "usedOnPages": ["/app/tools/transcript-parser"],
    "validation": "Validates transcript JSON, checks token balance, parses codes, returns structured output",
    "version": "1.0"
  },
  "delivery": {
    "endpoint": "/v1/tools/transcript-parser",
    "method": "POST",
    "receiptKeyPattern": "/receipts/tttmp/{account_id}/{event_id}.json",
    "receiptSource": "R2_VIRTUAL_LAUNCH",
    "signature": "TTTMP_TOOL_TRANSCRIPT_PARSER_EXECUTED"
  },
  "effects": {
    "dedupeKey": "{account_id}:{transcript_hash}",
    "eventIdFrom": "server",
    "writeOrder": ["receipt", "token_deduction", "parse_execution", "result_storage", "d1_index"],
    "writes": [
      {
        "target": "R2",
        "key": "/receipts/tttmp/{account_id}/{event_id}.json",
        "content": "Full event payload + timestamp"
      },
      {
        "target": "R2",
        "key": "/tokens/{account_id}.json",
        "content": "Updated token balance (decrement transcript_tokens by 1)"
      },
      {
        "target": "R2",
        "key": "/tttmp/transcript_results/{account_id}/{event_id}.json",
        "content": "Parsed transcript output (PII redacted)",
        "ttl": 2592000
      },
      {
        "target": "D1",
        "table": "tokens",
        "content": "Projection of R2 token balance"
      },
      {
        "target": "D1",
        "table": "tttmp_transcript_usage",
        "content": "Tool execution metadata"
      }
    ]
  },
  "payload": {
    "type": "object",
    "required": ["account_id", "transcript_data"],
    "properties": {
      "account_id": {
        "type": "string",
        "pattern": "^ACCT_[a-f0-9-]{36}$"
      },
      "transcript_data": {
        "type": "object",
        "required": ["transcript_type", "transactions"],
        "properties": {
          "transcript_type": { "type": "string", "enum": ["account", "return", "wage_income", "record"] },
          "transactions": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["code", "date", "amount"],
              "properties": {
                "code": { "type": "string", "pattern": "^\\d{3}$" },
                "date": { "type": "string", "format": "date" },
                "amount": { "type": "number" }
              }
            }
          }
        }
      }
    },
    "additionalProperties": false
  },
  "response": {
    "success": {
      "result_url": "https://r2.virtuallaunch.pro/tttmp/transcript_results/{account_id}/{event_id}.json",
      "parsed_summary": {
        "total_transactions": 15,
        "codes_found": ["150", "570", "846"],
        "balance_owed": 1234.56,
        "refund_amount": 0
      },
      "tokens_remaining": 9,
      "event_id": "EVT_..."
    },
    "error": {
      "code": "INSUFFICIENT_TOKENS | INVALID_TRANSCRIPT | RATE_LIMIT_EXCEEDED",
      "message": "Human-readable error"
    },
    "deduped": {
      "message": "Duplicate transcript detected — returning cached result",
      "original_event_id": "EVT_..."
    }
  },
  "schema": {
    "name": "tttmp.tool.transcript-parser.v1",
    "version": "1.0"
  }
}

VALIDATION CHECKLIST:
- [ ] Contract has all 7 sections
- [ ] contract.path matches file path
- [ ] Registry entry added
- [ ] Worker route: POST /v1/tools/transcript-parser
- [ ] Session validation at entry
- [ ] Token check uses transcript_tokens (not tax_tool_tokens)
- [ ] Write pipeline: receipt → token deduction → parsing → result storage → D1
- [ ] Result stored with 30-day TTL
- [ ] PII redacted in stored result (SSN, names)
- [ ] Rate limit: 5 req/min per account
- [ ] Dedupe uses {account_id}:{transcript_hash}
```

**Phase 1 Complete When:**
- [ ] All 3 milestones validated
- [ ] All contracts in registry
- [ ] All routes tested with valid session
- [ ] Token deduction verified via R2 inspection
- [ ] Receipts written to R2 for all tool executions
- [ ] D1 projections match R2 canonical state

---

## Phase 2: TTMP Transcript Dashboard

### Milestone 2.1: Job Submission UI

**Prompt:**
```
CONTEXT:
- Repository: VLP (web/app/app/transcripts/submit/page.tsx — to be created)
- Phase: 2 (TTMP Transcript Dashboard)
- Milestone: Transcript job submission UI
- Depends on: Phase 1 complete (transcript parser tool exists)

TASK:
Create a Next.js page that accepts transcript JSON upload, submits to POST /v1/tools/transcript-parser, displays token cost, shows submission confirmation.

CONSTRAINTS:
- Auth required: middleware.ts already guards /app/* routes
- File upload: accept .json only, max 1MB
- Display current transcript token balance before submission
- Show token cost (1 token) before submit button
- After submission: redirect to /app/transcripts/results/{event_id}
- Use API client from web/lib/api/client.ts
- Session token from web/lib/auth/session.ts

FILES TO MODIFY:
1. web/app/app/transcripts/submit/page.tsx (create)
2. web/app/app/transcripts/submit/page.module.css (create)
3. web/middleware.ts (add /app/transcripts/* to protected routes if not already)

VALIDATION CHECKLIST:
- [ ] Page created at correct path
- [ ] Auth middleware applied
- [ ] File upload validates .json format
- [ ] File size limited to 1MB
- [ ] Token balance fetched via GET /v1/tokens/balance/{account_id}
- [ ] Token cost displayed (1 transcript token)
- [ ] Submit button disabled if balance < 1
- [ ] Form submits to POST /v1/tools/transcript-parser
- [ ] Success: redirect to /app/transcripts/results/{event_id}
- [ ] Error handling: display error from Worker response
- [ ] CSS uses var() tokens from globals.css (no hardcoded colors)
```

### Milestone 2.2: Result History Dashboard

**Prompt:**
```
CONTEXT:
- Repository: VLP (web/app/app/transcripts/results/page.tsx — to be created)
- Phase: 2 (TTMP Transcript Dashboard)
- Milestone: Transcript result history dashboard
- Depends on: Milestone 2.1 (job submission exists)

TASK:
Create a Next.js page that lists all transcript parsing jobs for the logged-in user, shows status, links to individual results.

CONSTRAINTS:
- Auth required (already covered by middleware.ts)
- Fetch from GET /v1/tools/transcript-parser/history/{account_id} (to be created in Worker)
- Display: event_id, submission date, status, link to detail page
- Poll every 10 seconds if any job status = "processing"
- No real-time updates (poll-based only for Phase 2)

FILES TO MODIFY:
1. web/app/app/transcripts/results/page.tsx (create)
2. web/app/app/transcripts/results/page.module.css (create)
3. workers/src/index.js (add GET /v1/tools/transcript-parser/history/{account_id})
4. contracts/tttmp/tttmp.tool.transcript-parser-history.v1.json (create)
5. contracts/contract-registry.json (add entry)

WORKER ROUTE:
GET /v1/tools/transcript-parser/history/{account_id}

Returns:
{
  "jobs": [
    {
      "event_id": "EVT_...",
      "submitted_at": "2026-03-28T12:00:00Z",
      "status": "completed | processing | failed",
      "result_url": "https://r2.virtuallaunch.pro/tttmp/transcript_results/{account_id}/{event_id}.json"
    }
  ]
}

VALIDATION CHECKLIST:
- [ ] Worker route created
- [ ] Contract + registry entry added
- [ ] Frontend page created
- [ ] Auth middleware applied
- [ ] History fetched on page load
- [ ] Poll every 10s if status = "processing"
- [ ] Link to /app/transcripts/results/{event_id} for each job
- [ ] CSS follows var() token pattern
```

**Phase 2 Complete When:**
- [ ] User can submit transcript
- [ ] User can view submission history
- [ ] User can view individual result details
- [ ] Token balance updates after submission
- [ ] No errors on poll requests

---

## Phase 3: VLP Membership Gating

**Note:** Phase 3 prompts require significant Stripe integration work. Break into smaller milestones as needed. Key constraint: all billing writes must go through VLP contracts — TMP/TTMP/TTTMP may display pricing and launch purchase UX but must proxy writes through VLP API routes.

---

## Phase 4: TMP + DVLP + GVLP Tiers

**Note:** Phase 4 involves building out directory/matching UX. TMP, DVLP, GVLP read shared records (profiles, memberships) from VLP API. No direct writes to shared records.

---

## Phase 5: WLVLP Distribution

**Critical Constraint:** Canva exports are static content, NOT converted to React. Next.js wraps them with voting/bidding/buy-now UI layer. Zero PII on public surface.

---

## Contract Templates

### Canonical Contract Structure (All 7 Sections Required)

```json
{
  "auth": {
    "required": true,
    "type": "session | oauth | anonymous",
    "trustClientIdentityFields": false
  },
  "contract": {
    "authority": "VLP | TMP | TTMP | TTTMP | DVLP | GVLP | TCVLP | WLVLP",
    "governs": "Human-readable description of what this contract controls",
    "path": "/contracts/{domain}/{domain}.{action}.v{n}.json",
    "source": "vlp | tmp | ttmp | tttmp | dvlp | gvlp | tcvlp | wlvlp",
    "title": "Contract Title",
    "usedOnPages": ["/page/path"],
    "validation": "Human-readable validation summary",
    "version": "1.0"
  },
  "delivery": {
    "endpoint": "/v1/{domain}/{action}",
    "method": "GET | POST | PATCH | DELETE",
    "receiptKeyPattern": "/receipts/{domain}/{account_id}/{event_id}.json",
    "receiptSource": "R2_VIRTUAL_LAUNCH",
    "signature": "DOMAIN_ACTION_COMPLETED"
  },
  "effects": {
    "dedupeKey": "{account_id}:{unique_field}",
    "eventIdFrom": "server | client",
    "writeOrder": ["receipt", "canonical", "index"],
    "writes": [
      {
        "target": "R2 | D1 | KV",
        "key": "/path/to/object.json | table_name",
        "content": "Description of what gets written"
      }
    ]
  },
  "payload": {
    "type": "object",
    "required": ["field1", "field2"],
    "properties": {
      "field1": { "type": "string" },
      "field2": { "type": "number" }
    },
    "additionalProperties": false
  },
  "response": {
    "success": {
      "field": "value"
    },
    "error": {
      "code": "ERROR_CODE",
      "message": "Human-readable error"
    },
    "deduped": {
      "message": "Duplicate detected",
      "original_event_id": "EVT_..."
    }
  },
  "schema": {
    "name": "{domain}.{action}.v{n}",
    "version": "1.0"
  }
}
```

### Canonical Registry Entry

```json
{
  "id": "{domain}.{action}.v{n}",
  "path": "/contracts/{domain}/{domain}.{action}.v{n}.json",
  "version": "1.0",
  "status": "active | deprecated",
  "endpoint": "/v1/{domain}/{action}",
  "method": "GET | POST | PATCH | DELETE",
  "authRequired": true,
  "signatureRequired": false,
  "category": "auth | account | billing | booking | notification | support | token | tool",
  "usedOnPages": ["/page/path"],
  "receiptSource": "R2_VIRTUAL_LAUNCH",
  "receiptKeyPattern": "/receipts/{domain}/{account_id}/{event_id}.json",
  "dedupeKey": "{account_id}:{unique_field}",
  "writes": [
    {
      "target": "R2 | D1 | KV",
      "key": "/path/to/object.json | table_name"
    }
  ]
}
```

---

## Minimal Audit Submission Format

**Purpose:** Reduce token usage when submitting PR work for audit review.

### What to Submit

After a PR is implemented, submit ONLY this information for audit:

```
PR: #{number} — Milestone {X.Y}

CONTRACT FILE(S):
{filename}: {paste full JSON here}

REGISTRY ENTRY:
{paste just the new entry from contract-registry.json}

WORKER ROUTE SNIPPET:
{paste just the new route handler code — not entire file}

FRONTEND FILES (if applicable):
{filename}: {paste component code}

CHANGES SUMMARY:
- {bullet list of what was modified}
- {migrations run, tables added, etc.}

SELF-CHECK RESULTS:
[Copy validation checklist from milestone prompt, mark each item ✓ or ✗]
```

### What NOT to Submit

❌ Do NOT paste:
- Entire workers/src/index.js file
- Entire contract-registry.json file
- Unchanged files
- Documentation updates
- Package.json changes (unless adding new dependency)

### Example Audit Submission

```
PR: #42 — Milestone 1.1 (Form 2848 Tool)

CONTRACT FILE:
contracts/tttmp/tttmp.tool.form2848.v1.json:
{
  "auth": {
    "required": true,
    "type": "session",
    "trustClientIdentityFields": false
  },
  ...
}

REGISTRY ENTRY:
{
  "id": "tttmp.tool.form2848.v1",
  "path": "/contracts/tttmp/tttmp.tool.form2848.v1.json",
  "version": "1.0",
  "status": "active",
  "endpoint": "/v1/tools/form2848",
  ...
}

WORKER ROUTE SNIPPET:
// POST /v1/tools/form2848
router.post('/v1/tools/form2848', async (req, env) => {
  // Session validation
  const session = await validateSession(req, env);
  if (!session) return errorResponse('UNAUTHORIZED', 401);
  
  // Contract validation
  const payload = await req.json();
  const valid = validateContract(payload, 'tttmp.tool.form2848.v1');
  if (!valid) return errorResponse('INVALID_PAYLOAD', 400);
  
  // Token check
  const balance = await getTokenBalance(session.account_id, env);
  if (balance.tax_tool_tokens < 1) {
    return errorResponse('INSUFFICIENT_TOKENS', 402);
  }
  
  // Write pipeline
  const eventId = generateEventId();
  await writeReceipt(session.account_id, eventId, payload, env);
  await deductToken(session.account_id, 'tax_tool', 1, env);
  const pdf = await generateForm2848(payload.form_data);
  await storePDF(session.account_id, eventId, pdf, env);
  await updateD1Index(session.account_id, eventId, env);
  
  return jsonResponse({
    pdf_url: `https://r2.virtuallaunch.pro/tttmp/tool_results/${session.account_id}/${eventId}.pdf`,
    tokens_remaining: balance.tax_tool_tokens - 1,
    event_id: eventId
  });
});

CHANGES SUMMARY:
- Created contract: contracts/tttmp/tttmp.tool.form2848.v1.json
- Added registry entry for tttmp.tool.form2848.v1
- Added Worker route: POST /v1/tools/form2848
- No migrations needed (using existing tokens table)

SELF-CHECK RESULTS:
✓ Contract has all 7 sections
✓ contract.path matches file path
✓ Registry entry added with all required fields
✓ Worker route validates session before processing
✓ Token balance checked BEFORE deduction
✓ Token deduction writes to R2 first, then D1
✓ Receipt written before PDF generation
✓ PDF stored with 30-day TTL
✓ Rate limit applied (10/min per account)
✓ Error responses follow contract.response.error schema
✓ Dedupe logic checks dedupeKey from contract.effects
```

### Audit Response Format

Reviewer will respond with:

```
AUDIT: #{PR} — {PASS | FAIL}

{If PASS:}
✅ Approved for merge

{If FAIL:}
❌ Issues found:
1. {specific issue}
2. {specific issue}

Required fixes:
- {fix 1}
- {fix 2}
```

---

## Audit Checklists

### Contract Audit Checklist

Run this on every contract file before merging:

```
CONTRACT FILE: contracts/{domain}/{domain}.{action}.v{n}.json

STRUCTURE:
- [ ] File name matches pattern: {domain}.{action}.v{n}.json
- [ ] All 7 sections present: auth, contract, delivery, effects, payload, response, schema
- [ ] contract.path matches actual file path

AUTH SECTION:
- [ ] auth.required = true | false
- [ ] auth.type = session | oauth | anonymous
- [ ] auth.trustClientIdentityFields = false (unless explicitly justified)

CONTRACT SECTION:
- [ ] contract.authority = valid platform (VLP | TMP | TTMP | TTTMP | DVLP | GVLP | TCVLP | WLVLP)
- [ ] contract.governs is human-readable
- [ ] contract.path = /contracts/{domain}/{domain}.{action}.v{n}.json
- [ ] contract.source = vlp | tmp | ttmp | tttmp | dvlp | gvlp | tcvlp | wlvlp
- [ ] contract.usedOnPages lists at least 1 page
- [ ] contract.version = "1.0"

DELIVERY SECTION:
- [ ] delivery.endpoint starts with /v1/
- [ ] delivery.method = GET | POST | PATCH | DELETE
- [ ] delivery.receiptKeyPattern includes {account_id} and {event_id}
- [ ] delivery.receiptSource = R2_VIRTUAL_LAUNCH
- [ ] delivery.signature follows DOMAIN_ACTION_COMPLETED pattern

EFFECTS SECTION:
- [ ] effects.dedupeKey includes {account_id}
- [ ] effects.eventIdFrom = server | client
- [ ] effects.writeOrder = ["receipt", ...] (receipt always first)
- [ ] effects.writes lists all targets (R2, D1, KV)
- [ ] R2 writes include canonical object + receipt
- [ ] D1 writes are projections, not source of truth

PAYLOAD SECTION:
- [ ] payload.type = object
- [ ] payload.required lists mandatory fields
- [ ] payload.properties defines all fields
- [ ] payload.additionalProperties = false (strict validation)

RESPONSE SECTION:
- [ ] response.success defined
- [ ] response.error includes code + message
- [ ] response.deduped includes message + original_event_id

SCHEMA SECTION:
- [ ] schema.name = {domain}.{action}.v{n}
- [ ] schema.version = "1.0"
```

### Registry Audit Checklist

Run this on every registry entry before merging:

```
REGISTRY ENTRY: contracts/contract-registry.json

ENTRY STRUCTURE:
- [ ] id = {domain}.{action}.v{n}
- [ ] path matches contract file path
- [ ] version = contract.version
- [ ] status = active | deprecated
- [ ] endpoint matches contract delivery.endpoint
- [ ] method matches contract delivery.method
- [ ] authRequired = contract.auth.required
- [ ] signatureRequired matches contract.delivery needs
- [ ] category = valid category
- [ ] usedOnPages matches contract.usedOnPages
- [ ] receiptSource = R2_VIRTUAL_LAUNCH
- [ ] receiptKeyPattern matches contract delivery.receiptKeyPattern
- [ ] dedupeKey matches contract effects.dedupeKey
- [ ] writes lists all targets from contract effects.writes

CROSS-REFERENCE:
- [ ] Contract file exists at registry.path
- [ ] All registry fields match contract fields exactly
- [ ] No orphaned registry entries (contract file missing)
- [ ] No orphaned contracts (not in registry)
```

### Worker Route Audit Checklist

Run this on every Worker route before merging:

```
WORKER ROUTE: workers/src/index.js — {method} {endpoint}

ROUTE DEFINITION:
- [ ] Route defined in Worker router
- [ ] Endpoint matches contract delivery.endpoint
- [ ] Method matches contract delivery.method

AUTH:
- [ ] Session validation if contract.auth.required = true
- [ ] Session extracted from vlp_session cookie (HttpOnly, Secure, SameSite=Lax)
- [ ] account_id extracted from session, not trusted from payload

VALIDATION:
- [ ] Payload validated against contract.payload schema
- [ ] Invalid payload rejected before any processing
- [ ] Error response matches contract.response.error

WRITE PIPELINE:
- [ ] Receipt written to R2 first
- [ ] Receipt key matches contract delivery.receiptKeyPattern
- [ ] Canonical R2 object written second
- [ ] D1 writes happen after R2 writes
- [ ] D1 writes are projections, not source of truth

DEDUPE:
- [ ] Dedupe check uses contract.effects.dedupeKey
- [ ] Duplicate requests return contract.response.deduped

RATE LIMITING:
- [ ] Rate limit applied (if required for endpoint)
- [ ] Rate limit error matches contract.response.error

RESPONSE:
- [ ] Success response matches contract.response.success
- [ ] Error response matches contract.response.error
- [ ] All responses include event_id
```

### Frontend Page Audit Checklist

Run this on every frontend page before merging:

```
PAGE: web/app/{path}/page.tsx

FILE STRUCTURE:
- [ ] Page file exists at correct path
- [ ] CSS Module exists: {path}/page.module.css (if styled)
- [ ] CSS uses var() tokens from globals.css (no hardcoded colors)

AUTH:
- [ ] Protected routes included in middleware.ts
- [ ] Session token fetched via getSessionToken()
- [ ] API calls use session token in Authorization header

API CALLS:
- [ ] API client imported from web/lib/api/client.ts
- [ ] Payload matches contract.payload schema exactly
- [ ] No invented fields sent to Worker
- [ ] Error handling matches contract.response.error

UX:
- [ ] Loading states displayed during API calls
- [ ] Error messages displayed to user
- [ ] Success states trigger appropriate navigation/updates
- [ ] No PII displayed in client-side state beyond session lifetime
```

---

## PR Log

Track all PRs here for historical reference.

| PR # | Phase | Milestone | Status | Merged Date | Notes |
|------|-------|-----------|--------|-------------|-------|
| — | — | — | — | — | — |

**Example Entry:**
| PR # | Phase | Milestone | Status | Merged Date | Notes |
|------|-------|-----------|--------|-------------|-------|
| #42 | 1 | Form 2848 Tool | Merged | 2026-03-28 | Initial tool execution pattern established |

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-03-28 | System | Initial CODEX.md created — Phase 1 prompts complete |

---

**END OF CODEX.md**
