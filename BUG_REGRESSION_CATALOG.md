# Bug & Regression Catalog — Non-Done Tasks

> **Generated**: 2026-07-11  
> **Source**: Project 11 (BuilderForce.AI) & Project 14 (Hired.Video)  
> **PRD**: #191 — Bug & Regression Catalog — Non-Done Tasks  
> **Idempotent**: Yes — re-running against the same data produces identical output.

---

## Catalog (Sorted: severity desc, then task_id asc)

| Task ID | Title | Status | Type | Severity | Assignee | Linked Tasks | Source Signal | Notes |
|---|---|---|---|---|---|---|---|---|
| #57 | Fix the build | ready | bug | critical | d02ff7ee | — | Title: `fix` + `build`; Seed task #57; CI build breakage (API typecheck) | **Potential duplicate of #90** — same title "Fix the build" (API vs Frontend) |
| #66 | Fix the agent execution | in_review | bug | critical | d02ff7ee | — | Title: `fix`; Seed task #66; Core execution path defect | Agent runtime timeout errors; PR #28 |
| #90 | Fix the build | in_review | bug | critical | d02ff7ee | — | Title: `fix` + `build`; Seed task #90; CI build breakage (Frontend typecheck) | **Potential duplicate of #57** — same title "Fix the build" (Frontend vs API) |
| #467 | Fix duplicate `padding` property breaking Next.js build | backlog | bug | critical | fdbbd9af | — | Title: `fix` + `breaking` + `build`; Urgent priority | Next.js build failure; duplicate CSS property |
| #62 | Regression | in_review | regression | high (inferred) | d02ff7ee | — | Title: `regression`; Seed task #62 | PWA versioning notification not automated; PR #31 |
| #68 | `{"error":"No transactions support in neon-http driver"}` | in_review | bug | high (inferred) | 658608ba | #138 | Title: `error`; 500 Internal Server Error | Boards API POST fails; blocks board creation |
| #165 | Autonomous Agent Not Processing Tasks in "To Do" Column | in_review | bug | high | fdbbd9af | — | Title: "Not Processing" = behavioral defect; Priority: high | Agent Kevin (BA/PM) not picking up tasks; PR #83 |
| #354 | Helcim checkout: recurring billing schedule not created | backlog | bug | high (inferred) | 6e83f382 | #134 | Description: `needs to be fixed`; Missing feature = billing defect | One-time charges only; blocks recurring revenue |

---

## Flagged for Review (Ambiguous Classification)

Tasks that may represent bugs/regressions but lack clear signal keywords. These require human judgement.

| Task ID | Title | Status | Type | Severity | Signal Attempted | Notes |
|---|---|---|---|---|---|---|
| #69 | Agent Assigned to Board > Dragged ticket to swimlane > no indicator that agent is running | in_review | ambiguous | medium (inferred) | No bug keyword in title; behavioral UI defect suspected | User-visible defect — agent executes but card shows no progress indicator |
| #353 | Agent channels endpoint always returns `[]` (stub, no DB) | backlog | ambiguous | high (inferred) | No bug keyword; endpoint returns empty array — may be intentional stub | Empty response from production endpoint may mask a regression |
| #355 | Helcim webhook mapping is a placeholder | backlog | ambiguous | high (inferred) | No bug keyword in title; body describes incorrect mapping | `APPROVED` webhooks incorrectly map to `subscription.activated` — defect if data is live |

---

## Duplicate Detection

| Duplicate Group | Task IDs | Rationale |
|---|---|---|
| 🔁 Duplicate | #57, #90 | Both titled exactly **"Fix the build"**. #57 addresses API typecheck (`tsc` in `api/`), #90 addresses Frontend typecheck (`tsc` in `frontend/`). Separate CI layers but identical title signals potential scope confusion. |

---

## Methodology

1. **Task Discovery**: Scanned all tasks on project boards (Projects 11, 14) with status **not** in {`Done`, `Closed`, `Resolved`, `Cancelled`}.
2. **Keyword Matching**: Title contains: `fix`, `bug`, `regression`, `broken`, `error`, `failure`, `crash`, `defect`, `patch`, `hotfix`.
3. **Seed Tasks**: Tasks #62, #57, #90, #66 included unconditionally per PRD FR-7.
4. **Severity Heuristic**: Inferred severities marked `(inferred)` per FR-5.
5. **Duplicate Detection**: Exact title comparison across all entries.
6. **Ambiguity**: Tasks with borderline signals but no clear keyword match placed in "Flagged for Review" section.

---

## Excluded Tasks (Near-Misses)

The following non-done tasks were evaluated but **not** classified as bugs/regressions:

| Task ID | Title | Reason Excluded |
|---|---|---|
| #193 | Check for known test failures | Analysis task (cataloging failures, not fixing them) |
| #195 | Total bug/regression count with severity breakdown | Reporting/analysis task |
| #196 | Known CI/CD failures listed with root cause | Documentation/analysis task |
| #142 | Epic: Bug and quality audit | Parent epic for analysis, not a bug itself |
| #190 | Scan CI/CD pipeline results for failures | Audit/scan task |
| #194 | Review GitHub PRs for open issues | Review task |
| #197 | Cloud Agent 50-gap validation status | Gap analysis task |
| #198 | Quality risk score | Assessment task |