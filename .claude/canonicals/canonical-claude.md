# canonical-claude.md

## 1. Header (identity + scope)
- Repo name
- Product name
- Domain
- Last updated
- One-line purpose

## 2. System Definition
- What the system is
- What it is NOT
- Audience
- Stack (explicit)
- Backend dependencies (explicit ownership)

## 3. Hard Constraints (top-level, early)
- No backend changes in this repo
- Do not modify source CSV columns
- Never output invalid email values
- Never invent endpoints or contracts

## 4. Terminology (Canonical Language Layer)
- Defines allowed vs forbidden terms
- Maps legacy to canonical

## 5. Repo Structure (Source of Truth Map)
- Directory tree
- What each folder does
- What is authoritative vs generated

## 6. Data Contracts (Strict)
### 6.1 Source of Truth
- File paths, ownership
### 6.2 Schema Definitions
- Columns, types, rules
### 6.3 Append-Only / Mutation Rules
- What can be changed, what cannot

## 7. Execution Logic (Deterministic Flows)
### 7.1 Selection Logic (ordered, mandatory)
### 7.2 Processing Steps
### 7.3 Output Definitions

## 8. External Interfaces
- R2 keys, API dependencies, Worker responsibilities, Cron ownership

## 9. Personalization / Business Logic Layer
- Email rules, subject patterns, dynamic variables

## 10. Routing / URL Rules
- URL structure, slug rules, dedup logic, key mapping

## 11. Lifecycle / Scheduling
- Cron timing, event triggers, state transitions

## 12. Operational Loop (Daily/Batch Flow)
- Step-by-step runbook

## 13. Metrics / Business Context
- Time savings, revenue impact, positioning

## 14. Reference Docs Priority
- Which doc wins when they conflict

## 15. Hard Constraints (Repeat / Reinforce)
- Re-state critical constraints at bottom

## 16. Related Systems / Repos
- Paths, responsibilities, boundaries

## 17. Canonicals Enforcement (mandatory on every task)

Before writing any file, check whether the file type has a canonical template.
Canonical templates live in `.claude/canonicals/` in the VLP repo and define
the required structure for each file type across all 8 repos.

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
Canonical templates live in the VLP repo only (`virtuallaunch.pro/.claude/canonicals/`).
Other repos reference them via their CLAUDE.md but do not maintain local copies.
The Principal Engineer is responsible for ensuring compliance across all 8 repos.