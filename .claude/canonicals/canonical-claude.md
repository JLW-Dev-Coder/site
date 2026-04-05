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