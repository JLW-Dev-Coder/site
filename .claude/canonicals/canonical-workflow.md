# canonical-workflow.md

A workflow is a human-executed operational playbook for a specific repo.
It tells the owner exactly what to do, in what order, with what tools.
Every workflow follows this structure.

---

## Required Sections (in order)

### 1. Header
- Workflow name
- Repo name
- Owner
- Last updated

### 2. Objective
One paragraph. What this workflow accomplishes and why it matters.
What uncertainty, risk, or friction it removes.

### 3. Materials Needed
Everything the human needs before starting. Listed once, referenced throughout.

| Material | Type | URL / Location |
|----------|------|---------------|

No hunting. If a phase needs a login, it is listed here.

### 4. Required Output Schema (if applicable)
The exact column order and field definitions for any CSV or data output this workflow produces. Notes on which fields are required, which are auto-generated, and which are ignored by downstream tools.

### 5. Table of Contents
Linked TOC to every phase. The user can see where they are at a glance.

### 6. Phases
Each phase is a discrete unit of work. Phases run in order.
Each phase contains tasks. Tasks run in order within their phase.

#### Phase structure:

## Phase N — {Name}

### Objective
Why this phase exists. What it unlocks.

### Tasks

#### Task N.1 — {Name}

**Purpose:** Why this task exists. What uncertainty or risk it removes.

**Action:** What must be done in plain language. No ambiguity.

**Inputs required:**
- Files: what files are needed
- Access: what logins or permissions
- Context: what must be true before starting
- Preconditions: what previous tasks must be complete

**Steps:**
1. Do this
2. Then this
3. Then this

**Validation (done when):**
- [ ] Condition 1 is true
- [ ] Condition 2 is true

**Outputs created:**
What now exists that did not before (file, state change, confirmation).

**Failure mode if skipped:**
What breaks later if this task is rushed or skipped.

**Next:** Task N.2 or Phase N+1

### 7. Batch Cadence (if applicable)
How often this workflow repeats. What triggers a new cycle.

### 8. File Cleanup Summary (if applicable)
| When | Delete what | Why |

### 9. File Reference
| File | Purpose | Who writes it |

---

## Rules

- Every task ends with "Next:" — no dead ends
- Every task has validation criteria — the human knows when they are done
- Every phase has an objective — the human knows why they are doing it
- Materials are listed once at the top, never buried in task steps
- Login URLs are never omitted — if a task needs a browser, the URL is here
- Steps are imperative ("Do this") not descriptive ("This is done by...")
- No Claude jargon — this is for the human, not for Repo Claude
- Output schema is defined once and referenced, never repeated across tasks
- If the workflow produces output for multiple downstream systems, the fork point is a single explicit task with clear split criteria and validation that no item appears in both outputs
