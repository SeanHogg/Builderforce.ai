# 15 — PRD: Stakeholder Alignment Diagnostic — Category 6 (Epic #155)

**First-pass spec** — defines canonical questions, branching logic, data models, conflict rules, sign-off protocol state machine, escalation SLAs, reminders, and reporting metrics so downstream implementation can proceed.

## 1. Problem & Goal

**Problem:** Projects slip due to hidden stakeholder misalignment: priorities are not explicitly agreed, stakeholders submit competing P0s for the same team, required approvers are stale/missing, conflicts sit >48h without sign-off, and current plans drift from agreed priorities. There is no systematic diagnostic to detect this.

**Goal:** Implement Category 6 (Stakeholder Alignment) of the Diagnostic Question Engine as a first-pass spec. This pass defines the canonical questions, branching logic, data models, and rules wiring required for downstream implementation. Outputs must be persisted to a structured health profile attached to the project and feed escalation and reporting.

## 2. Scope

**In Scope (First Pass Spec):**

- Task 504: Canonical Questions, Branching Logic, Health Profile Schema
- Task 505: Stakeholder Map & Required Approvers Registry
- Task 506: Conflict Detection Rules Engine
- Task 507: Sign-off Protocol State Machine & Escalation Path + Reminders
- Task 508: Reporting Dashboard (metrics) & Weekly Digests

**Wiring definitions only** — data models, interfaces, state transitions, SLAs, and acceptance criteria for implementation in next turn.

## 3. Target Users / ICP Roles

- **Primary - Diagnostic Runner:** Program / Delivery Lead, Product Manager running the health check.
- **Secondary - Stakeholders:** Eng Lead, Product Lead, Design Lead, GTM Lead who submit P0s and must sign-off.
- **Tertiary - Approvers / Leadership:** Directors/VPs in escalation chains.
- **System - Diagnostic Engine:** Service that evaluates rules, state machine, and generates digests.

## 4. Canonical Questions (Task 504)

Define 5 canonical questions for Category 6:

### Q1: Are priorities clear and agreed across stakeholders?
- `id`: `stakeholder_alignment::priorities_clear`
- `text`: Are priorities clear and agreed across stakeholders?
- `type`: `boolean` with optional evidence link (e.g., a linked PRD or backlog priority document).
- `weight`: `2` (high impact on alignment).
- `required_evidence`: Document title and author, last reviewed date, or a linked roadmap snippet.

### Q2: Are competing P0s reconciled?
- `id`: `stakeholder_alignment::competing_p0s_reconciled`
- `text`: Are competing P0s reconciled?
- `type`: `boolean` with optional evidence link (e.g., a resolution meeting note or resolved conflict ticket).
- `weight`: `2`
- `required_evidence`: Resolved conflict ID, resolution date, or linked resolution ticket.

### Q3: Are required approvers current and complete?
- `id`: `stakeholder_alignment::approvers_complete`
- `text`: Are required approvers current and complete?
- `type`: `boolean` with optional evidence link (list of current approvers + confirmation dates).
- `weight`: `1`
- `required_evidence`: List of required approver roles with last confirmed date.

### Q4: Have any active conflicts exceeded 48hr without sign-off?
- `id`: `stakeholder_alignment::overdue_conflicts`
- `text`: Have any active conflicts exceeded 48hr without sign-off?
- `type`: `boolean` with optional evidence link (overdue conflict_id, detected_at, current timestamp).
- `weight`: `3` (escalation trigger).
- `required_evidence`: Overdue conflict ID, detected_at, sign_off_deadline, last_update.

### Q5: Does the current plan / roadmap reflect the agreed priorities?
- `id`: `stakeholder_alignment::plan_alignment`
- `text`: Does the current plan / roadmap reflect the agreed priorities?
- `type`: `boolean` with optional evidence link (alignment score between PRD and roadmap).
- `weight`: `2`
- `required_evidence`: PRD version, roadmap version, alignment score, last sync timestamp.

All answers save to `project.health_profile.stakeholder_alignment`.

## 5. Branching Logic (Task 504)

- **Branching trigger:** If Q1 == No OR Q4 == Yes (overdue >48h) -> require Q2 and trigger conflict scan.
- **Conflict path:** If conflict detection finds active conflict -> require Q4 evidence and force sign-off protocol to `Blocked`.
- **Stale approvers:** If Q3 == No (approvers stale) -> branch to remediation: prompt to update stakeholder map before survey close.

## 6. Health Profile Persistence (Task 504)

Define `HealthProfile` as a JSON BSON document persisted on the `Project` entity under a new `health_profile` JSON column:

```prisma
model Project {
  id          String   @id @default(uuid())
  tenantId    String
  segmentId   String

  // ... existing fields ...

  health_profile Json?  // Versioned, structured JSON

  // ... other fields
}
```

### HealthProfile JSON schema

```json
{
  "version": 1,
  "category_scores": {
    "stakeholder_alignment": {
      "score": 85,        // 0..100
      "last_run_at": "2026-07-19T14:30:00Z"
    }
  },
  "stakeholder_alignment": {
    "answered_at": "2026-07-19T14:30:00Z",
    "canonical_questions": [
      { "id": "stakeholder_alignment::priorities_clear", "answer": true, "weight": 2 },
      { "id": "stakeholder_alignment::competing_p0s_reconciled", "answer": true, "weight": 2 },
      { "id": "stakeholder_alignment::approvers_complete", "answer": true, "weight": 1 },
      { "id": "stakeholder_alignment::overdue_conflicts", "answer": false, "weight": 3 },
      { "id": "stakeholder_alignment::plan_alignment", "answer": true, "weight": 2 }
    ],
    "branching_and_flags": {
      "need_conflict_scan": false,
      "force_sign_off_blocked": false,
      "stale_approvers_detected": false
    },
    "active_conflicts": [],
    "escalation_status": null
  },
  "active_conflicts": [],
  "approver_coverage_pct": 100,
  "escalation_status": null,
  "audit_history": [
    {
      "timestamp": "2026-07-19T14:30:00Z",
      "runner_user_id": "...",
      "branching_predictions": { "need_conflict_scan": false, ... }
    }
  ]
}
```

Key attributes:
- `category_scores.stakeholder_alignment.score`: Computed as weighted average of answered questions; capped at 100, floor at 0.
- `stakeholder_alignment.canonical_questions[].answer`: boolean.
- `stakeholder_alignment.branching_and_flags`: derived from questions and conflict detection (see §8).
- `active_conflicts[]`: List of active conflict entries (see §8).
- `approver_coverage_pct`: Percentage of required approvers confirmed within last 30 days.
- `escalation_status`: null if no escalated items; string "L1", "L2", "L3", "Expired" otherwise.
- `audit_history`: Immutably appended entries per diagnostic run.

## 7. Stakeholder Map (Task 505)

Define stakeholders per project/team. Store as a denormalized JSON column on `Project`.

### StakeholderMap JSON schema

```json
{
  "version": 1,
  "stakeholders": [
    {
      "stakeholder_id": "uuid-or-external-id",
      "user_id": "federated:account@company",  // from IdentityCache
      "role": "Engineering Lead | Product Lead | Design Lead | GTM Lead ...",
      "is_required_approver": true,
      "team_scope": "frontend-platform | api-gateway | ... | null (global)",
      "p0_submission": {
        "p0_id": "uuid",
        "text": "First-Priority request text",
        "submitted_at": "2026-07-19T12:00:00Z"
      } | null,
      "last_confirmed_at": "2026-07-15T08:00:00Z",  // null if not required approver
      "is_active": true
    }
  ],
  "review_window_days": 7,  // default, configurable per project
  "stale_threshold_days": 30
}
```

- `team_scope`: String, matches `Team` display name or equivalent (null if global).
- `last_confirmed_at`: Timestamp of last confirmation for `is_required_approver=true`. Stale if >30 days since confirmation or `is_active=false`.
- Required approvers registry must be current-checked on every diagnostic run.

## 8. Conflict Detection Rules (Task 506)

### Rule 1: Competing P0s

**Condition:**
- Two distinct stakeholders with `is_active=true`
- Same `team_scope`
- Different P0 – `p0_submission.p0_id` or `p0_submission.text` differ
- `submitted_at` within `review_window_days` of each other (i.e., both within last N days)

**Outcome:** Create an `active_conflict` entry:

```json
{
  "conflict_id": "uuid",
  "type": "competing_p0",
  "team_scope": "frontend-platform",
  "stakeholders": [ "stakeholder_a_id", "stakeholder_b_id" ],
  "p0s": [
    { "p0_id": "uuid", "text": "First P0 request" },
    { "p0_id": "uuid", "text": "Second P0 request" }
  ],
  "detected_at": "2026-07-19T10:30:00Z",
  "status": "active"
}
```

**State transition:** If conflict exists, set `stakeholder_alignment.force_sign_off_blocked = true` (prevent alignment score from being Green).

### Conflict Rule Extensibility

The rule engine must be:
- **Deterministic:** Same inputs always produce the same outputs.
- **Extensible:** Additional rule types (e.g., conflicting owners) added via new rule definitions without changing core engine code.
- **Run on:** P0 submission (when `stakeholder.p0_submission` updates) and on every diagnostic run.

### Unit Cases for Conflict Identification

- **Case A (Active Conflict):** Stakeholder A and Stakeholder B submit different P0s for same team within `review_window_days`. → `active_conflict` created.
- **Case B (Same P0):** Stakeholder A and Stakeholder B submit the same `p0_id` (or identical text) for same team. → No conflict (deduplicated).
- **Case C (Outside Window):** Stakeholder A submits a P0, but Stakeholder B submits within 3 days after the window closes. → No conflict triggered on diagnostic run (P0 already expired as actionable).
- **Case D (Different Teams):** Same stakeholder submits P0s for two different teams. → No conflict triggered (same person, different scopes allowed in v1).
- **Case E (Inactive User):** Stakeholder marked `is_active=false` submits P0. → Not considered active stakeholder; no conflict triggered.

## 9. Sign-off Protocol State Machine (Task 507)

Define a per-sign-off protocol state machine (one `sign_off_protocol` per conflict or per-track). State output persisted in `Project.health_profile.sign_off_protocols`.

### States

- `Draft`
- `PendingReview`
- `Approved`
- `ApprovedWithComment`
- `Blocked`
- `Escalated`
- `Resolved`
- `Expired`

### Transitions

| From | To | Trigger | Conditions |
|------|----|--------|------------|
| `PendingReview` | `Approved` | `Approve` | `Approver` is `is_required_approver`; no reason required. |
| `PendingReview` | `ApprovedWithComment` | `ApproveWithComment` | Same as above; `comment` field present and non-empty. |
| `PendingReview` | `Blocked` | `Block` | `Approver` is `is_required_approver`; `reason` present. |
| `Any` | `Escalated` | Auto | `Blocked` → escalate; also on `PendingReview > 48h` without transition (see SLA). |
| `Escalated` | `Resolved` | `Resolve` | All required approvals provided at escalated level. |
| `Escalated` | `Expired` | Auto | Final level reached, no resolution after final deadline (see SLA). |
| `Approved/ApprovedWithComment` | `Resolved` | Manual | Optional final confirmation and archival. |

Only an `is_required_approver` can transition from `PendingReview`. `Block` requires a reason (persisted).

### 48hr Rule

- Measure duration in `PendingReview`. If `now - started_at > 48h` and no transition has occurred, flag as overdue and:
  - Set `stakeholder_alignment.overdue_conflicts = true`.
  - Trigger reminder notification.
  - Auto-transition to `Escalated` if a finer-grained escalation level is reached, otherwise force next level.

### Example Timeline (for 3-level escalation L1→L2→L3, each 3-day SLA)

**Simplified per-level flow:**
- **Day 0 (Detection):** `PendingReview` created (via Rule 1). 48hr metric starts.
- **Days 0–1:** Reminder scheduled for ~24h and ~4h before Level 1 SLA (3 days from now).
- **Level 1 SLA (Day 3):** If still `PendingReview`, escalate to L2 (`Escalated`). Start L2 timer.
- **Level 2 SLA (Day 6):** If still unresolved, escalate to L3 (`Escalated`). Start L3 timer.
- **Level 3 SLA (Day 9):** If still unresolved and unreplied by L3 approver, move to `Expired` state and notify Diagnostic Runner.

All events (reminders, escalations, resolved, expired) log to `health_profile.audit_history`.

## 10. Escalation Path and Reminders (Task 507)

### Escalation Chains

Each team/project can have a configurable escalation chain:

- **L1:** Primary approver (usually Product or Engineering lead).
- **L2:** Secondary approver (e.g., Director/Senior VP).
- **L3:** Exec-level approver (e.g., CTO/CPO) — final stage.

Chain is stored in `Project.health_profile.escalation_chain`.

### SLA

- **Per level SLA:** 3 days from `PendingReview` start (or from level shift).
- **Reminders:** Automated notifications at:
  - 24h before SLA deadline.
  - 4h before SLA deadline.
- **Final expiration:** After final level (`L3`), if unresolved for SLA, move to `Expired`, stripe `escalation_status`, notify Diagnostic Runner.

### Event Log Persistence

Every significant event (reminder sent, escalation triggered, state change with reason, resolution/expiry) is logged:

```json
{
  "event_id": "uuid",
  "protocol_id": "uuid",
  "timestamp": "2026-07-19T14:30:00Z",
  "from_state": "PendingReview",
  "to_state": "Escalated",
  "trigger": "auto_escalation_pending_review_48hr",
  "actor_user_id": null,
  "actor_agent_ref": "escalation-service",
  "details": { "level": "L2" }
}
```

All events appended to `health_profile.sign_off_events` and `health_profile.audit_history`.

## 11. Reporting Dashboard & Weekly Digests (Task 508)

### Dashboard Metrics (5+)

Define calculated metrics per project/team, computed from `health_profile` fields.

**1. Alignment Score (0–100)**
- Formula: Weighted average of answered canonical questions (`stakeholder_alignment.canonical_questions`), excluding unanswered fields. Floor 0, cap 100.
- Display: Green/Yellow/Red badge normalized across team.

**2. # Active Conflicts**
- Formula: Count of conflicts in proposal where `status = "active"` under `stakeholder_alignment.active_conflicts`.

**3. # Overdue Sign-offs (>48h)**
- Formula: Boolean under `stakeholder_alignment.overdue_conflicts` (count returned as 0 or 1 for a per-project view; rolled up over the team for aggregate views).

**4. Approver Coverage %**
- Formula: Count of confirmed approvers (`last_confirmed_at` within the last 30 days) divided by the count of required approvers (`is_required_approver = true`), as a percentage, capped at 100.

**5. Escalation Rate (All-Time per project)**
- Formula: `sum_escalated / total_sign_off_protocols`.

**6. Avg Time to Sign-off**
- Formula: Average duration from `PendingReview` start to `Resolved` or `Expired`, across all resolved/expired entries.

### Filters

Dashboard supported filters:
- Project
- Team
- Time window (last 6 months/LTM)
- Alignment segment (High/Medium/Low by score)

### Weekly Digest Template

Scheduled job generates summary per project. Template (fields include at minimum):

```
=== Stakeholder Alignment Weekly Digest for {project_display_name} ===

**Summary Score: {alignment_score} ({overall_grade})**
  - Active Conflicts: {active_conflicts_count}
  - Overdue Sign-offs: {overdue_signoffs_count}
  - Approver Coverage: {approver_coverage_pct}%
  - Escalations This Week: {escalations_count}
  - Avg Time to Sign-off: {avg_signoff_duration}

**Active Conflicts:**
{ for each conflict:
  - [{conflict_id}] {type} ({team_scope}): {stakeholder_a} vs {stakeholder_b}
    * P0s: {p0_a_preview} vs {p0_b_preview}
    * Detected: {detected_at}
    * Status: {status}
}

**Overdue Sign-offs >48h:**
{ for each overdue:
  - [{protocol_id}] {context}: overdue since {overdue_since}
    * Last update: {last_updated_by} at {last_timestamp}
}

**Escalations to {next_level} (if any):**
{ list escalations }

**Action Items for Stakeholders:**
{ checklist of actions (e.g., confirm approvers, resolve conflict) }
```

### Delivery Channels

Digest delivery via:
- Email (configurable per project/team in `Project.settings.health_notifications`).
- Slack webhook (configurable for the tenant or project).

## 12. Acceptance Criteria (First Pass Spec)

- **AC-504:** 5 canonical questions defined with IDs, weights, types, and branching logic documented; `HealthProfile` JSON schema defined and attached to project model spec.
- **AC-505:** Stakeholder Map schema supports P0 submissions, required approver flag, team scope, staleness detection (30-day rule), and `review_window_days` parameter.
- **AC-506:** Conflict rule correctly identifies case: Stakeholder A and B submit different P0s for same team within `review_window_days` → active conflict created; same P0 or outside window → no conflict. Unit cases specified (Case A–E above).
- **AC-507:** State machine diagram and transition table for sign-off includes Approve / ApproveWithComment / Block → Escalated. SLA of 3 days per level and reminder schedule at 24h/4h before deadline specified with example timeline.
- **AC-508:** Reporting spec defines 5+ metrics formulas, filters, and weekly digest template with fields. Digest includes at least: alignment score, active conflicts list, overdue >48h list, escalations.

## 13. Out of Scope (v1)

- Actual code implementation of engine, UI components, or API endpoints (next turn).
- Auto-resolution of P0 conflicts or AI-based priority recommendation.
- Integration with external HRIS for org chart sync — manual stakeholder map only in v1.
- Real-time chat, in-app commenting threads beyond `ApproveWithComment`.
- Modification of categories 1–5 of Diagnostic Engine.
- Custom escalation SLAs beyond 3-day default (configurable later) or out-of-band extensions.