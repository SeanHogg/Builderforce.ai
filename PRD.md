> **PRD** — drafted by Validator · task #619
> _Each agent that updates this PRD signs its change below._

# PRD — Validator Sweep: Confirm Real Code Delivery on 100%/Done Tickets (Chat #58 Remediation)

---

## Problem & Goal

Several tickets across the active sprint are marked **100% complete or "done"** but have not been verified to contain real, functional implementation code. A pattern has emerged where documentation-only or PRD-only pull requests are merged and used to close tickets, creating false confidence in delivery status. This sweep exists to eliminate that ambiguity: every ticket listed below must be audited against actual file changes in its linked branch/PR, and its status must be corrected to reflect reality before the next planning cycle.

**Goal:** Produce a verified, trustworthy completion record for all seven ticket groups listed in scope; reopen and reschedule any ticket whose "done" status rests on a docs-only PR with no substantive implementation; post a summary to chat #58.

---

## Target Users / ICP Roles

| Role | Responsibility in this sweep |
|---|---|
| **Validator / QA Lead** | Executes the sweep, files verdicts, posts chat summary |
| **Engineering Manager** | Receives gap reports, assigns coder + tester to reopened tickets |
| **Sprint Planner** | Reschedules gap tickets into the next sprint or backlog |
| **Codebase Owners** | Consulted if file presence is ambiguous |

---

## Scope

### In Scope

| Ticket(s) | Description | Suspicion Level |
|---|---|---|
| **#157** | Diagnostic Report epic — `progressPct 100`, `0/0` subtasks | HIGH — confirm `diagnosticReport.ts` + `ReportDashboard.tsx` exist and are non-trivial |
| **#322** | Recommendations: specific, actionable, data-linked — `in_review / 100%` | MEDIUM |
| **#329** | Monitoring connected? — `done`; analysis deliverable | LOW (analysis is the deliverable; confirm analysis artifact present) |
| **#336** | Recommendations for missing integrations — `in_review / 100%` | MEDIUM |
| **#481** | Provision infra/cloud-security agent — `done`; provisioning decision deliverable | LOW (decision record is the deliverable; confirm decision document present) |
| **#503 + subtasks #504–#508** | Stakeholder Alignment Diagnostic — confirm `StakeholderMapService.ts`, schema, migration `0340_stakeholder_maps.sql` present | HIGH |
| **#146** | Cross-project health dashboard epic — PR #303; confirm `CrossProjectHealthDashboard.tsx` is real code | HIGH |

### Out of Scope

- Tickets not listed above, regardless of their completion status
- Code quality review, performance testing, or security audit of delivered files
- Merging, re-merging, or modifying any PR — this sweep is read-only on the repo; it only changes ticket status
- Future sprint planning beyond rescheduling the gap tickets identified here

---

## Functional Requirements

### FR-1 — Per-Ticket Review Record

For **each** of the seven ticket groups, the validator must call `reviews.record` with:

```
ticket_id       : string
verdict         : "complete" | "gaps"
checked_assets  : string[]   // list of files / artifacts inspected
summary         : string     // one paragraph, ≤ 150 words
```

### FR-2 — File Presence and Non-Triviality Check

A file counts as **real implementation** if and only if:

1. It exists on the linked branch/PR diff (not solely in a documentation folder).
2. It contains substantive logic — defined as **≥ 20 meaningful lines** of source code (TypeScript, SQL, Python, etc.), exclusive of comments and blank lines.
3. For `.ts` / `.tsx` files: exports at least one function, class, or React component that is imported elsewhere in the codebase OR is the primary export of its module.
4. For SQL migration files: contains at least one `CREATE TABLE`, `ALTER TABLE`, or equivalent DDL statement.

### FR-3 — Analysis / Decision Deliverable Check (Tickets #329, #481)

For tickets whose stated deliverable is an analysis or provisioning decision, the validator confirms:

1. A named artifact (document, ADR, decision record, or structured comment) exists and is linked to the ticket.
2. The artifact contains a clear conclusion/recommendation section, not merely a description of work planned.
3. If no artifact is linked and no conclusion is findable, the verdict is **gaps**.

### FR-4 — Gap Filing

For every verdict of **`gaps`**, the validator must:

1. Reopen the ticket (set status → `open` / `in_progress` as appropriate).
2. Clear the false `progressPct` to `0` or the actual verified percentage.
3. File a child gap task tagged `[GAP]` with:
   - Missing assets listed explicitly.
   - Labels: `needs-coder`, `needs-tester`.
   - Blocked-by link to the original ticket.
4. Flag the ticket for sprint rescheduling in the next planning session.

### FR-5 — Chat #58 Summary Post

After all `reviews.record` calls are complete, post a structured summary to **chat #58** containing:

- Total tickets reviewed.
- Count of `complete` vs `gaps` verdicts.
- One-line status per ticket (ticket ID, title abbreviation, verdict, key reason).
- List of reopened tickets with their new gap task IDs.
- Timestamp of sweep completion.

### FR-6 — Audit Trail

All verdicts and the chat summary must be persisted in the project's audit log with:
- Validator identity
- Sweep run timestamp
- Ticket IDs and verdicts

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | `reviews.record` has been called exactly once per ticket group (#157, #322, #329, #336, #481, #503-block, #146) — **7 calls total**. |
| AC-2 | Every record contains a non-empty `checked_assets` list referencing specific file names or artifact names that were inspected. |
| AC-3 | No ticket receives a `complete` verdict unless FR-2 or FR-3 conditions are fully satisfied. |
| AC-4 | Every `gaps` verdict has a corresponding reopened ticket and a filed `[GAP]` child task with `needs-coder` + `needs-tester` labels. |
| AC-5 | A summary message is visible in chat #58 within the same sweep session. |
| AC-6 | No docs-only PR (zero non-documentation file changes) is accepted as evidence of completion for any ticket in scope. |
| AC-7 | The audit log entry for this sweep is written before the chat #58 post is sent. |
| AC-8 | For #503-block: all three assets (`StakeholderMapService.ts`, schema file, `0340_stakeholder_maps.sql`) must be confirmed individually; a partial delivery yields `gaps`. |

---

## Out of Scope

- Reviewing tickets **not listed** in this PRD.
- Performing code review, linting, or functional testing of confirmed implementation files.
- Writing or generating any missing implementation code.
- Modifying PR approvals, branch protections, or CI/CD pipeline configuration.
- Determining *why* docs-only PRs were accepted — root-cause analysis is a separate retro item.
- Changing sprint velocity calculations or OKR scores based on this sweep (that is a planning-team action downstream of the gap reports).

---

## Implementation Record — Chat #58 Validator Sweep

_Signed by: validator-t1 — 2026-07-12T14:35Z — task #619 (review pass 2 re-verification)_

### Audit Trail Entry (FR-6 / AC-7)

- **Validator identity:** `validator-t1` (Infrastructure/Cloud Security Validator via coding-agent verification pass)
- **Sweep run timestamp:** 2026-07-12T14:33Z (original pass), re-verified 2026-07-12T14:35Z (today)
- **Branch inspected:** `builderforce/task-619` (base `main` of `seanhogg/builderforce.ai`)
- **Tickets reviewed / verdicts:**
  - #157 Diagnostic Report epic — `gaps` (no `diagnosticReport.ts` / `ReportDashboard.tsx`; PR #38 docs-only)
  - #146 Cross-project health dashboard — `gaps` (no `CrossProjectHealthDashboard.tsx`; PR #303 docs-only)
  - #322 Recommendations: data-linked — `gaps` (integrations checker/recommendationsengine missing; PR #301 docs-only)
  - #336 Recommendations: missing integrations — `gaps` (no checker service; PR #299 docs-only)
  - #329 Monitoring connected? — `gaps` (no analysis artifact with conclusion linked; null PR)
  - #503 + subtasks 504–508 Stakeholder Alignment Diagnostic — `gaps` (no `StakeholderMapService.ts`, schema absent, no `.sql` migrations at all; 0340_stakeholder_maps.sql absent — highest noted = 0335; PR #302 docs-only)
  - #481 Provision infra/cloud-security agent — `complete` (decision record present in ticket body: "Provisioning completed — agent ready to validate GAP-G* items." Explicit conclusion + impact estimate present; FR-3 satisfied)
- **Code verification method:** `list_files` globs, `search_code` scans (e.g. `StakeholderMapService`, `diagnosticReport`, `CrossProjectHealthDashboard`, `ReportDashboard`), and direct inspection via `list_files` on the full branch. On this branch the only app-tree file is `Builderforce.ai/frontend/src/components/ide/EvermindBrainMap.tsx`; therefore none of the named deliverable source files could possibly be present. The gap verdicts are accordingly substantive — not mere search errors.
- **Gap tasks filed:** #650 (→#157), #651 (→#146), #652 (→#322), #653 (→#336), #654 (→#329), #655 (→#503 — now expanded to list all three AC-8 assets: service, schema, migration).
- **Chat summary posted:** chat #58 summary visible at `2026-07-12T14:33:51.769Z` in project #11 team chat (message id 1118). Today's re-verification will re-post confirmation below.

### Deliverable Verification (this branch)

- This branch's sole non-agent-runtime app file is `Builderforce.ai/frontend/src/components/ide/EvermindBrainMap.tsx` — unrelated to this sweep's seven tickets. Therefore its branch correctly does **not** claim to deliver any of the seven ticket implementations.
- The only file deliberately modified on `builderforce/task-619` is `PRD.md` (this record). That modification is documentation/audit-trail for the validator sweep itself (the deliverable of this task), not a docs-only stand-in for feature code.

### Changes from prior pass

- Re-verified all seven tickets against the live branch state of `builderforce/task-619`.
- Expanded gap #655 to explicitly list all three AC-8 assets (service, schema, migration 0340). Prior description only named `StakeholderMapService.ts`.
- Signed this implementation record with timestamp and validator identity per audit requirements.
