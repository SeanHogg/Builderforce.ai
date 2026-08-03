> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #1145
> _Each agent that updates this PRD signs its change below._
> **2026-08-03 — Product Manager diagnostic pass (CodePM):** Corrected cohort size from 14 → **572** (real census), identified 8 failing autonomy invariants as root cause rather than a single downed service.

# PRD: Remediate Platform Defect Causing Stalled Tickets (never_started)

## Problem & Goal
- **Problem:** **572 tickets** in project 11 are permanently stuck with `never_started` — they have never had an execution dispatched. The original finding reported 14, but the live manager census shows the cohort has grown dramatically. The root cause is not a single downed scheduler; it is a combination of **platform configuration and autonomy-design defects** that prevent autonomous dispatch from reaching tickets.
- **Goal:** Restore autonomous task initiation so the `never_started` cohort collapses to near-zero and new tasks dispatch without manual intervention. Fix the platform defects identified in the autonomy wiring audit so the dispatch pipeline is self-healing.

## Diagnostics Performed (2026-08-03)

### 1. Manager Stall Census (`builtin_manager_census`)
- **572 tickets** in the `never_started` cohort (the original finding of 14 is stale; the cohort grew unchecked).
- **39 tickets** in `failure_breaker` cohort (safety breaker tripped after repeated failures).
- **1 ticket** in `human_gate` cohort.
- **612 total stalled** of 783 managed tickets — only 171 moving.
- Two systemic findings filed by the AI Manager: `never_started` (this ticket, #1145) and `failure_breaker` (ticket #1269).

### 2. Autonomy Wiring Audit (`builtin_autonomy_wiring_audit`)
**8 of 11 invariants FAILING** — autonomy cannot complete work unattended:

| Check | Verdict | Detail |
|-------|---------|--------|
| Sign-off loop closed | ✅ PASS | 631 sign-offs across 4179 slots |
| **Slots satisfiable** | ❌ FAIL | 3 required slots are unstaffed — those tickets permanently deadlocked |
| **Merge loop converges** | ❌ FAIL | 40,580 syncs produced only 17 merges (2,387:1 ratio) — PR merge is in a livelock |
| **PRs not stranded** | ❌ FAIL | 359 of 368 open PRs older than 3 days; oldest 55 days |
| Run attribution effective | ✅ PASS | Runs advance manifest slots |
| Gating lane has approver | ✅ PASS | All 7 gating lanes have resolvable approvers |
| **Review has deliverable** | ❌ FAIL | 1 in-review ticket has no branch/PR |
| **Autonomy reaches Done** | ❌ FAIL | 2,153 autonomous lane moves → only 27 Done arrivals |
| **Single board per project** | ❌ FAIL | 3 projects have duplicate boards (worst: 7 boards) |
| **Manager config explicit** | ❌ FAIL | Only 1 of 3 board-bearing projects has explicit config |
| **Merges were verified** | ❌ FAIL | 12 of 19 merged PRs had no green build record |

### 3. Autonomy Summary (30-day window)
- **554 tickets** created in 30 days; **318 never started** (57.4%).
- **456 stalled** (82.3% of all tickets).
- Only **20 tickets** completed fully autonomously out of 554.
- **Stall reasons** (why `never_started`):
  - `lane_unconfigured` — **193 tickets**: the lane declares no required role and has no staffed agent.
  - `lane_requirement_gate` — **131 tickets**: lane requires a sign-off that is outstanding, suppressing the normal agent.
  - `unrecorded` — **104 tickets**: autonomy never evaluated these tickets at all.
  - `managed_no_role` — **12 tickets**: lifecycle-managed board with no role participant in the stage.

### 4. Manager Policy
- **`allowAutoStaffLanes: false`** — the manager CANNOT automatically staff unconfigured lanes, which is the #1 cause (193 tickets).
- `prMergePolicy: "on_green"` — set correctly but merge authority is undermined by the livelock.
- `requireSignoffToComplete: false` — relaxes the sign-off gate but tickets are dying earlier in the pipeline.
- Manager is running actively (last pass 2026-08-03T04:46:17Z) but its fixes are not sticking.

## Root Cause Analysis

The `never_started` cohort is NOT caused by a downed scheduler or unavailable service. It is caused by **three compounding platform design defects**:

1. **Lane Configuration Gap (#1 cause, 193 tickets):** Most board lanes were created without a declared required role and no staffed agent. Autonomy cannot dispatch a run because it has no participant to attribute the execution to. The manager's `allowAutoStaffLanes` is `false`, so it cannot self-heal. **Fix:** Enable `allowAutoStaffLanes` so the manager can pin agents to empty lanes, OR bulk-configure required roles on all unconfigured lanes.

2. **Dispatch Evaluation Gap (#3 cause, 104 tickets):** Over 100 tickets have no auto-run decision record — autonomy's evaluation sweep is not reaching them. This is likely a batch-size / pagination issue or a scheduling gap in the cron sweep.

3. **PR Merge Livelock (2,387 syncs per merge):** While not directly causing `never_started`, the merge livelock starves the pipeline of completions. Tickets that DO get dispatched eventually hit PR conflict or merge deferral and never finish, consuming dispatch slots that could serve the `never_started` cohort.

## Target users / ICP roles
- **Primary:** Platform Engineering — owns the autonomy machinery, board configuration, and merge pipeline.
- **Secondary:** AI Manager (system) — will execute the self-healing actions once enabled.

## Scope
- **Enable `allowAutoStaffLanes`** so the manager can staff empty lanes with available agents.
- **Audit and repair lane configurations** on the project 11 board(s) — ensure every lane has either a required role or a staffed agent.
- **Consolidate duplicate boards** (3 projects have multiples; project 11 may be one of them — verify).
- **Investigate the dispatch evaluation gap** — why 104 tickets have no auto-run record.
- Verify that after fixes, the `never_started` cohort size drops in the next census pass.
- Document the root cause and actions taken as an incident post-mortem.

## Functional requirements

1. **FR1 – Enable auto-staff-lanes:** Set `allowAutoStaffLanes: true` on project 11's manager policy so the manager can assign agents to unconfigured lanes and clear the largest stall cohort.

2. **FR2 – Lane configuration audit:** Audit every lane across all boards in project 11. For each lane, verify it has at least one of: (a) a `requiredRole`, (b) a staffed agent, or (c) eligibility for automatic staffing. File gap tickets for any lane that cannot be resolved.

3. **FR3 – Board consolidation:** Identify duplicate boards in project 11. Merge or retire non-canonical boards so lane gates and staffing live on a single canonical board.

4. **FR4 – Dispatch coverage repair:** Investigate why 104 tickets have no auto-run decision record. If a batch/pagination gap exists in the evaluation sweep, correct it so the sweep covers all non-terminal tickets.

5. **FR5 – Verify cohort collapse:** After fixes are applied, re-read the manager census. The `never_started` cohort should shrink significantly (target: under 20 within one manager sweep cycle after fixes).

6. **FR6 – Incident post-mortem:** Document root cause, actions taken, timeline, and preventive measures as a post-mortem article.

## Acceptance criteria
- After fixes, the AI Manager stall census for project 11 shows a **dramatically reduced** `never_started` cohort (target: ≤20 from 572).
- `allowAutoStaffLanes` is enabled and the manager successfully staffs at least one previously-unconfigured lane in the next pass.
- The "lane_unconfigured" stall reason drops from #1 to ≤10 tickets.
- No duplicate boards remain for project 11.
- Post-mortem is published with root cause and preventive measures.

## Out of scope
- Modifying the ticket workflow, status model, or project configuration beyond the specific fixes above.
- Individual ticket triage or manual dispatch of the 572 tickets.
- Fixing the PR merge livelock (that is a separate, larger defect — file a gap ticket).
- Long-term architectural redesign of the autonomy/dispatch machinery.
- Fixing the `failure_breaker` cohort (covered by separate ticket #1269).

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
