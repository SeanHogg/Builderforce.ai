> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1535
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Dispatch Evaluation Coverage Fix

**Parent**: #1145 (Platform: never_started cohort remediation)  
**Status**: Draft  
**Author**: Senior Product Architect

---

## Problem & Goal

**Problem**: 104 tickets in project 11 exhibit an `unrecorded` stall reason—the autonomy dispatch evaluator has never assessed them. These tickets are non-terminal and should have been evaluated during routine sweeps. The gap points to one or more systemic issues: a pagination or batch‑size bug in the evaluation sweep, a cron schedule that misses windows, or a filter that erroneously excludes certain lanes or ticket states. Left unresolved, the coverage gap will silently accumulate more unevaluated tickets, eroding trust in autonomy and biasing decision metrics.

**Goal**: Eliminate the evaluation coverage gap so that **all non-terminal tickets** in project 11 (and any affected projects) are reliably evaluated by the dispatch sweep. Specifically, after the fix, the 104 unevaluated tickets will be evaluated within the next scheduled sweep cycle, and no new tickets will fall into an unrecorded state.

---

## Target Users / ICP Roles

- **Platform Engineering / Dispatch Service Owners**: Responsible for operating and maintaining the dispatch evaluation sweep infrastructure. They need clear root cause and a stable fix.
- **Dispatch Operators & SREs**: Monitor evaluation health and rely on `stall_reason` for incident response. They require equal coverage across lanes so alerting is not muted.
- **Data Analysts / Autonomy Performance Teams**: Consume evaluation outcomes for model performance dashboards; incomplete data skews cohort analyses and A/B comparisons.

---

## Scope

### In Scope

1. Audit the dispatch evaluation sweep’s code, configuration, and recent execution logs for project 11.
2. Identify why the 104 specific tickets (and any other undiagnosed cohorts) are never reached by the evaluator.
   - Examine batch‑query logic, pagination, cursor management, and transaction isolation.
   - Verify cron schedule and execution overlap boundaries.
   - Inspect lane/state filters, terminal‑state definitions, and exclusion rules.
3. Implement a correction that guarantees all non‑terminal tickets (no `terminal_state` flag) are included in **at least one** sweep iteration.
4. Verify the fix in a staging environment with a replica of the problematic dataset.
5. Deploy to production and confirm that the 104 tickets are evaluated within **one sweep cycle** post‑deployment, with no new unrecorded tickets emerging.

### Out of Scope

- Manual retroactive marking or backfilling of previous unrecorded periods (the fix will naturally catch them on the next sweep, but no historical record modification before that sweep).
- Changes to the evaluation algorithm itself (scoring, decision logic) – only the scheduling/discovery layer.
- Direct modification of ticket data in production databases outside of the standard evaluation write path.
- Long‑term monitoring dashboard or alerting additions (though adding a simple metric/log is acceptable if it aids verification; a full observability revamp is out of scope).

---

## Functional Requirements

1. **Audit Trail & Reproduction**
   - The investigation must produce a documented root‑cause explanation and a reproducible test case that demonstrates the gap (using the set of 104 ticket IDs).
   - Root cause must be traced to a specific code or configuration artifact (pagination offset error, missing join, cron overlap exclusion, etc.).

2. **Fix Implementation**
   - Adjust the evaluation sweep such that **all non‑terminal tickets** are candidates for evaluation during one full sweep cycle.
   - If pagination is the cause, correct the batch size and cursor logic so no ticket is skipped due to offset windows.
   - If a filter is too restrictive, broaden it to include the missing lanes/states, or add a secondary catch‑all pass for any ticket with `NULL` or absent `stall_reason`.
   - If the cron schedule is at fault, align the schedule with the evaluation window so no tickets are missed at boundaries.

3. **Idempotency & Overlap Safety**
   - The fix must not cause duplicate evaluation records for tickets already correctly processed in previous sweeps.
   - Any re‑evaluation of the 104 tickets must respect existing data (they have no prior evaluation record, so the sweep should treat them as new candidates).

4. **Validation Instrument**
   - Include a monitoring hook (e.g., a counter `unrecorded_tickets_after_sweep`) that is emitted after each sweep to detect any remaining unevaluated non‑terminal tickets. This value must be zero post‑fix.

---

## Acceptance Criteria

1. **Root Cause Identified**: A documented, peer‑reviewed analysis pinpoints why the 104 tickets were excluded.
2. **Fix Deployed to Production**: The revised sweep configuration or code is live.
3. **Zero New Unrecorded Tickets**: After the first full sweep cycle post‑deployment:
   - All 104 tickets now have a non‑null `stall_reason` and an evaluation record.
   - A query `SELECT COUNT(*) FROM tickets WHERE project_id = 11 AND stall_reason IS NULL AND NOT terminal_state` returns 0.
4. **No Regression**: Existing evaluation records for previously covered tickets remain unchanged (MD5 hash of key evaluation columns unchanged for a sampled subset).
5. **Monitoring Confirmation**: The new `unrecorded_tickets_after_sweep` metric is 0 for at least 3 consecutive sweep cycles.
6. **Stakeholder Sign‑Off**: Dispatch operators confirm the gap is closed and no anomalous alerts trigger due to missing evaluations.

---

## Out of Scope

(Already detailed above; reiterated for clarity.)

- Historical backfill of missing records outside the next sweep.
- Renovation of the overall evaluation framework.
- Changes to ticket terminal‑state definitions.
- Dashboard or UI changes beyond the metric addition.

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