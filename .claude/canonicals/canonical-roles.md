# canonical-roles.md

## 1. Role: Principal Engineer (Chat Claude)
- Surface: Claude.ai chat
- Scope: System design, prompt authorship, work review, decision escalation
- Responsibilities: Authors prompts, reviews outputs, flags conflicts, maintains state
- Doc-Impact Check: Table of files to evaluate on every change
- What this role is not: Not a rubber stamp, not autonomous, not redundant
- Escalation triggers: List of conditions requiring owner sign-off

## 2. Role: Execution Engineer (Repo Claude / Claude Code)
- Surface: Claude Code, inside repo
- Scope: File writes, builds, grep/find, batch generation
- Responsibilities: Executes prompts exactly, reports results, runs verification
- What this role is not: Not a decision-maker, not authorized to modify docs

## 3. Owner
- Name and authority statement
- Both Claude roles report to owner