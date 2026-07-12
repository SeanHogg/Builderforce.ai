# PRD 17 — Stakeholder Alignment Diagnostic (first-pass wiring)

**Status:** Proposed (2026-07-12) · **Owner:** Operator · **Epic #155**: Diagnostic Question Engine — Category 6

**Scope:** This is a specification/first‑pass wiring pass. Code implementation (engine, UI, API endpoints, data access, tests) is out of scope for this turn and is deferred to subsequent tasks or tickets as defined in the PRD.

**Related designs:** See `docs/design/basis-payload` for external schemas and case studies. See `specs/builderforce/README.md` for the context of numbered PRDs. See PRD 02 for domain model, PRD 04 for agentic dev primitives, and PRD 08 for governance model.

---

## 1. Problem & Goal

**Problem:** Projects slip due to hidden stakeholder misalignment:
- Priorities are not explicitly agreed.
- Two stakeholders submit different P0s for the same team.
- Required approvers are stale or missing.
- Conflicts sit >48h without sign‑off.
- Current plans drift from agreed priorities.

There is no systematic diagnostic to detect these.

**Goal:** Implement Category 6 (Stakeholder Alignment) of the Diagnostic Question Engine as a first‑pass spec:
- Define canonical questions, branching logic, and audit schema.
- Wire stakeholder map, conflict detection, sign‑off state machine, escalation SLA, and reminders.
- Define reporting metrics and weekly digest template.
- Persist outputs to a structured health profile attached to the project.

This pass is scoped to **questions, data models, rules engine, state machine, SLA, and reporting wiring**. Actual code implementation is out of scope for this turn and is pursued in subsequent tasks (504–508 as listed on the board).

---

## 2. Target Users / ICP Roles

*   **Primary — Diagnostic Runner:** Program / Delivery Lead, Product Manager running the health check.
*   **Secondary — Stakeholders:** Eng Lead, Product Lead, Design Lead, GTM Lead who submit P0s and must sign‑off.
*   **Tertiary — Approvers / Leadership:** Directors/VPs in escalation chains.
*   **System — Diagnostic Engine:** Service that evaluates rules, runs state machines, generates digests.

---

## 3. Scope

**In Scope (First‑Pass Spec, Wiring Only):**

*   Task wiring: canonical questions, stakeholder map, conflict detection rules, sign‑off protocol state machine, escalation path and reminders, reporting dashboard + weekly digests.
*   Questions (FR1) with IDs, branching logic (FR2), and HealthProfile schema persistence (FR3).
*   Stakeholder map schema supporting P0s, required approvers, team scope, staleness rules, and review window (FR4).
*   Conflict detection rule logic (Rule 1 — competing P0s) (FR5): case grammar A–E.
*   Sign‑off state machine (FR6): states, transitions, 48h rule, approver transitions, comment, blocking.
*   Escalation path + reminders (FR7): L1/L2/L3 chains, 3‑day per‑level SLA, reminder schedule (24h/4h), expired state, event logging.
*   Reporting dashboard metrics (FR8) with formulas, plus weekly digest template and delivery channels.
*   All tasks 504–508 are wove into this spec as design boundaries; actual implementation (engine/API/UI) proceeds in subsequent turns.

**Out of Scope:**
*   Actual code implementation of engine, UI components, or API endpoints (next turn).
*   Auto‑resolution of P0 conflicts or AI‑based priority recommendation.
*   Integration with external HRIS for org‑chart sync (manual stakeholder map only in v1).
*   Real‑time chat, in‑app commenting threads beyond ApproveWithComment.
*   Modification of categories 1–5 of Diagnostic Question Engine.
*   Custom escalation SLAs beyond 3‑day default (configurable later).

---

## 4. Functional Requirements (Wiring)

### FR1: Canonical Questions (Task 504 Scope)
The system MUST provide 5 canonical questions for Category 6.

| id | text | type | weight | required_evidence |
|---|---|---|---|---|
| q1 | True: Are priorities clear and agreed across stakeholders? | boolean | 100 | `project.decision_log` |
| q2 | True: Have competing P0s been reconciled? | boolean | 80 | `stakeholder_p0_conflicts` resolved list |
| q3 | True: Are required approvers current and complete? | boolean | 100 | `stakeholder_map.approvers.updated_at` |
| q4 | True: Have any active conflicts exceeded 48hrs without sign‑off? | boolean | 120 | sign‑off_protocol.active_sign_offs |
| q5 | True: Does the current plan / roadmap reflect the agreed priorities? | boolean | 80 | roadmap.decisions vs. stakeholder P0 overlay |

Each question object has: `id`, `text`, `type` (boolean + evidence link), `weight`, `required_evidence`. Stored to `project.health_profile.stakeholder_alignment`.

### FR2: Branching Logic (Task 504 Scope)

*   If Q1 == **No** OR Q4 == **Yes** (>48h overdue) -> require Q2 and trigger conflict scan.
*   If conflict detection finds an active conflict -> require Q4 evidence and force sign‑off protocol to **Blocked**.
*   If Q3 == **No** (approvers stale) -> branch to remediation: prompt to update stakeholder map before survey close.

### FR3: Health Profile Persistence (Task 504 Scope)

`HealthProfile` attached to `Project`:
- `project_id` (UUID).
- `category_scores`: `{ stakeholder_alignment: number }`.
- `answers`: array of question answers `{ id, value, timestamp, evidence }`.
- `last_run_at`: ISO 8601 timestamp.
- `active_conflicts`: array of conflict summaries.
- `escalation_status`: enum `none | pending | escalated | resolved`.
- `approver_coverage_percentage`: number (0–100).

Structured, versioned JSON with audit history (stored under `airbyte_health_profiles` or equivalent, consistent with domain model and next‑pass migrations). Schema reference: `docs/design/basis-payload/health-profile-schema.json`.

### FR4: Stakeholder Map (Task 505 Scope)

Per project/team:

```ts
StakeholderMap = {
  project_id: UUID,
  stakeholders: [
    {
      user_id: UUID,
      role: StakeholderRole,
      is_required_approver: boolean,
      team_scope?: string, // e.g., 'infrastructure', 'frontend'
      p0_submission: {
        p0_id: string,
        text: string,
        submitted_at: ISO_8601,
      } | null,
      is_active: boolean,
    }
  ],
  review_window_days: number, // default 7
};
```

**Rules:**
- Required approvers registry current‑checked: stale if >30 days since last confirmed or user deactivated.
- P0 submissions linked via `p0_submission`, with `team_scope` to enable conflict detection.

External schema: `docs/design/basis-payload/stakeholder-map-schema.json`.

### FR5: Conflict Detection Rules (Task 506 Scope)

**Rule 1 — Competing P0s:**

```
IF (two distinct stakeholders with is_active=true
    submit different P0s for the same team_scope
    WHERE submitted_at is within review_window)
THEN create Conflict{
  type: competing_p0,
  team_scope: string,
  stakeholders: User[],
  p0s: [P0],
  detected_at: ISO_8601,
  status: active
};
```

The rule engine must be:
- Deterministic on inputs.
- Extensible (future rules can be added via configuration or code).
- Run on P0 submission and on diagnostic run.

Active conflicts block alignment score from being **Green**.

**Unit Cases (A–E):** See `docs/design/basis-payload/conflict-cases-a-e-toplevel.json` for complete case grammar.

### FR6: Sign‑off Protocol State Machine (Task 507 Scope)

**States:** `Draft` → `PendingReview` → **Approved | ApprovedWithComment | Blocked** → `Escalated` → **Resolved | Expired**.

**Transitions:**
- `Approve` → `Approved`
- `ApproveWithComment` → `ApprovedWithComment` (requires comment)
- `Block` → `Blocked` → auto‑triggers escalation
- Only `is_required_approver` can transition from `PendingReview`. Block requires reason.

**48h rule:**
- If >48h in `PendingReview` without transition:
  - Flag overdue and trigger reminder.
  - `Q4` becomes true.

State diagram and transition table included in the spec; see `docs/design/basis-payload/sign-off-state-machine-stakeholder-alignment-2020-12.json` for machine JSON.

### FR7: Escalation Path and Reminders (Task 507 Scope)

**Escalation chains:** Configurable L1, L2, L3 per team/project with users/groups.

**SLA:** 3 days per level. On block or timeout, escalate to next level.

**Reminders:**
- Automated notifications at 24h and 4h before per‑level deadline.
- After final level moves to `Expired`, notify Diagnostic Runner.

All events logged to health profile (`escalation_log`).

External schema reference: `docs/design/basis-payload/escalation-sla-reminders-stakeholder-alignment-2020-12.json`.

### FR8: Reporting Dashboard (Task 508 Scope) & Weekly Digests

**Dashboard metrics:**

| Metric | Formula | Description |
|---|---|---|
| Alignment Score | `weighted_sum / total_weight` | 0–100, computed from Q‐answers |
| # Active Conflicts | Count of `conflicts.status="active"` | |
| # Overdue Sign‑offs (>48h) | Count of `sign_offs.submitted_at < now - 48h && current_state != "Approved"` | |
| Approver Coverage % | `(required_approvers_count / all_non_inactive_stakeholder_count) * 100` | |
| Escalation Rate | `(escalations_total / signoffs_total) * 100` | |
| Avg Time to Sign‑off | `sum(signature_durations) / count` | `signature_duration` is time from `PendingReview` to a terminal state |

Filters supported per project/team/time window.

**Weekly digest:**
- Scheduled job generates summary per project/team.
- Includes: alignment score, new conflicts, overdue items (>48h sign‑offs), escalations, alignment trend.
- Delivery via email and/or Slack webhook (configurable).

External schema reference: `docs/design/basis-payload/reporting-metrics-factory-stakeholder-alignment-2020-12.json`.

---

## 5. Acceptance Criteria

*   **AC-504:** 5 canonical questions defined with stable IDs, branching rules, and `HealthProfile` JSON schema attached to Project model spec.
*   **AC-505:** `StakeholderMap` schema supports P0 submissions, `is_required_approver` flag, team scope, staleness detection (30‑day rule), and `review_window_days` parameter.
*   **AC-506:** Conflict rule correctly identifies case: Stakeholder A and B submit different P0s for same team within review_window → active conflict created; same P0 or outside window → no conflict. Unit cases A–E specified (see design artifacts).
*   **AC-507:** Sign‑off state machine diagram and transition table include Approve / ApproveWithComment / Block → Escalated. SLA of 3 days per level and reminder schedule at 24h/4h specified with schedule JSON example.
*   **AC-508:** Reporting spec defines 6+ metrics formulas and weekly digest template with fields. Digest includes at least: alignment score, active conflicts list, overdue >48h list, escalations.
*   Sub‑tasks 504–508 are wired to this spec with clear boundaries; actual implementation (code) proceeds in subsequent turns or tickets.

---

## 6. Related Designs

All schemas and case studies referenced in the PRD are provided under `docs/design/basis-payload`:

| Artifact | Path |
|---|---|
| HealthProfile JSON schema | `docs/design/basis-payload/health-profile-schema.json` |
| StakeholderMap JSON schema | `docs/design/basis-payload/stakeholder-map-schema.json` |
| Conflict Cases A–E (top‑level view) | `docs/design/basis-payload/conflict-cases-a-e-toplevel.json` |
| Sign‑off State Machine | `docs/design/basis-payload/sign-off-state-machine-stakeholder-alignment-2020-12.json` |
| Escalation SLA + Reminders | `docs/design/basis-payload/escalation-sla-reminders-stakeholder-alignment-2020-12.json` |
| Reporting metrics & digest factory | `docs/design/basis-payload/reporting-metrics-factory-stakeholder-alignment-2020-12.json` |
| Branching Logic schema | `docs/design/basis-payload/branching-logic-stakeholder-alignment-2020-12.json` |

These artifacts version at `2020-12` to match standardized frontier and support AI‑forward diagramming or verification; they may be updated in future turns without renaming.

---

## 7. Tasks and Dependencies (Wiring Only)

*   **Task 504 (Canonical Questions, Branching, HealthProfile):** FR1–FR3, AC‑504.
*   **Task 505 (Stakeholder Map & Required Approvers Registry):** FR4, AC‑505.
*   **Task 506 (Conflict Detection Rules Engine):** FR5, AC‑506.
*   **Task 507 (Sign‑off Protocol State Machine & Escalation Path + Reminders):** FR6–FR7, AC‑507.
*   **Task 508 (Reporting Dashboard + Weekly Digests):** FR8, AC‑508.

All tasks are defined on the board under Epic #155; this PRD provides the wiring and acceptance criteria for implementation in subsequent turns. No code changes are made in this pass; the PRD is a design document.