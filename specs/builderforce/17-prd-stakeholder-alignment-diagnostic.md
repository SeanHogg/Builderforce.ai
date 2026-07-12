# PRD 17 — Stakeholder Alignment Diagnostic (Category 6, Epic #155)

**Status:** Spec (first-pass) · **Owner:** Validator · **Epic:** #155 · **Sub-tasks:** #504–#508

## 1. Problem & Goal

**Problem:** Projects slip due to hidden stakeholder misalignment: priorities are not explicitly agreed, two stakeholders submit different P0s for the same team, required approvers are stale/missing, conflicts sit >48h without sign-off, and current plans drift from agreed priorities. There is no systematic diagnostic to detect this.

**Goal:** Implement Category 6 (Stakeholder Alignment) of the Diagnostic Question Engine. This pass defines the canonical questions, branching logic, data models, and rules wiring required for downstream implementation. Outputs must be persisted to a structured health profile attached to the project and feed escalation and reporting.

## 2. Target Users / ICP Roles

| Role | Engagement |
|------|-----------|
| **Program / Delivery Lead** | Runs the diagnostic; acts on results |
| **Product Manager** | Runs the diagnostic; owns P0 submissions |
| **Eng Lead, Product Lead, Design Lead, GTM Lead** | Stakeholders who submit P0s and participate in sign-off |
| **Directors / VPs** | Escalation chain L2/L3 approvers |
| **Diagnostic Engine (System)** | Evaluates rules, manages state machine, generates digests |

## 3. Scope

### In Scope (First-Pass Spec)

- **Task 504:** Canonical Questions, Branching Logic, Health Profile Schema
- **Task 505:** Stakeholder Map & Required Approvers Registry
- **Task 506:** Conflict Detection Rules Engine
- **Task 507:** Sign-off Protocol State Machine & Escalation Path + Reminders
- **Task 508:** Reporting Dashboard (metrics) & Weekly Digests

All outputs are **wiring definitions only** — data models, interfaces, state transitions, SLAs, and acceptance criteria. Actual code implementation of engine, UI, or API endpoints is deferred to the next turn.

### Out of Scope

- Actual code implementation (engine, UI components, API endpoints)
- Auto-resolution of P0 conflicts or AI-based priority recommendation
- Integration with external HRIS for org chart sync (manual stakeholder map only)
- Real-time chat or in-app commenting threads beyond `ApproveWithComment`
- Modification of Diagnostic Engine categories 1–5
- Custom escalation SLAs beyond the 3-day default

---

## 4. Functional Requirements

### FR-1: Canonical Questions (Task 504)

The system MUST provide exactly 5 canonical questions for Category 6:

| # | ID | Text | Type | Weight | Required Evidence |
|---|----|------|------|--------|-----------------|
| Q1 | `stakeholder_alignment.q1_priorities_clear` | Are priorities clear and agreed across stakeholders? | `boolean + evidence_link` | 0.25 | Meeting notes, priority doc link |
| Q2 | `stakeholder_alignment.q2_competing_p0s_reconciled` | Are competing P0s reconciled? | `boolean + evidence_link` | 0.25 | Conflict resolution log, reconciled priority list |
| Q3 | `stakeholder_alignment.q3_approvers_current` | Are required approvers current and complete? | `boolean + evidence_link` | 0.15 | Stakeholder map snapshot, last-reviewed date |
| Q4 | `stakeholder_alignment.q4_overdue_signoffs` | Have any active conflicts exceeded 48h without sign-off? | `boolean + evidence_link` | 0.20 | Conflict list with detection timestamps |
| Q5 | `stakeholder_alignment.q5_plan_reflects_priorities` | Does the current plan / roadmap reflect the agreed priorities? | `boolean + evidence_link` | 0.15 | Roadmap diff, priority→epic mapping |

Each question MUST be persisted as a `QuestionResponse` object:

```json
{
  "question_id": "stakeholder_alignment.q1_priorities_clear",
  "answer": true,
  "evidence_link": "https://...",
  "answered_by": "user_id",
  "answered_at": "2026-07-12T10:00:00Z",
  "notes": "Priorities confirmed in weekly sync"
}
```

### FR-2: Branching Logic (Task 504)

The diagnostic engine MUST implement the following branching rules:

```
IF Q1 == false OR Q4 == true (overdue >48h)
  THEN require Q2 (mandatory) AND trigger conflict scan
  -> Q1 triggers Q2 regardless of Q4 state

IF conflict detection (FR-5) finds >= 1 active conflict
  THEN require Q4 evidence (force re-upload)
  AND force sign-off protocol state to Blocked
  -> Q4 becomes NOT_APPLICABLE UNTIL all conflicts resolved

IF Q3 == false (approvers stale)
  THEN branch to remediation:
    -> prompt user to update stakeholder map (Task 505)
    -> diagnostic cannot close until map is updated
```

Branching is evaluated in order: Q1 → Q4 → conflict → Q3. Each branch is evaluated once per diagnostic run; answers are cached per run.

### FR-3: Health Profile Persistence (Task 504)

A `HealthProfile` object MUST be attached to each `Project`:

```json
{
  "project_id": "uuid",
  "category_scores": {
    "stakeholder_alignment": 0.75
  },
  "answers": [
    {
      "question_id": "stakeholder_alignment.q1_priorities_clear",
      "answer": true,
      "evidence_link": "https://...",
      "answered_by": "user_id",
      "answered_at": "2026-07-12T10:00:00Z",
      "notes": ""
    }
  ],
  "last_run_at": "2026-07-12T10:00:00Z",
  "active_conflicts": [
    {
      "conflict_id": "uuid",
      "type": "competing_p0",
      "status": "active",
      "detected_at": "2026-07-11T14:00:00Z"
    }
  ],
  "approver_coverage_pct": 80.0,
  "escalation_status": "none",
  "version": 2
}
```

**Versioning:** The `version` field increments on each update. A full audit history is maintained as a separate `health_profile_audit` log (append-only).

**Score calculation:** `stakeholder_alignment` = weighted sum of boolean answers (true=1.0, false=0.0) × question weight. If any question is unanswered, the weight is re-normalised across answered questions only. If Q4 is `NOT_APPLICABLE` (due to active conflicts), it is excluded from the denominator.

---

### FR-4: Stakeholder Map (Task 505)

Per project or team, a `StakeholderMap` MUST be defined:

```json
{
  "project_id": "uuid",
  "stakeholders": [
    {
      "user_id": "uuid",
      "role": "eng_lead",
      "is_required_approver": true,
      "team_scope": "platform",
      "p0_submission": {
        "p0_id": "uuid",
        "text": "Ship auth v2 by end of Q3",
        "submitted_at": "2026-07-10T09:00:00Z"
      },
      "is_active": true,
      "confirmed_at": "2026-06-15T10:00:00Z",
      "last_activity_at": "2026-07-10T09:00:00Z"
    }
  ],
  "review_window_days": 7,
  "last_reviewed_at": "2026-07-10T10:00:00Z",
  "reviewed_by": "user_id"
}
```

**Staleness rules:**
- A required approver is **stale** if `confirmed_at` > 30 days ago **OR** the user's account is deactivated.
- The `review_window_days` parameter defaults to 7. It controls the window for conflict detection (FR-5): two P0 submissions are considered competing only if they fall within the same `review_window_days` span.
- `is_active = false` means the stakeholder is no longer participating (e.g., left the project). Their P0 submissions are excluded from conflict detection.

---

### FR-5: Conflict Detection Rules (Task 506)

**Rule 1 — Competing P0s (primary rule):**

```
IF two distinct stakeholders (A, B)
  WHERE A.is_active = true AND B.is_active = true
  AND A.p0_submission.text != B.p0_submission.text
  AND A.team_scope = B.team_scope
  AND ABS(A.p0_submission.submitted_at - B.p0_submission.submitted_at)
      <= review_window_days
THEN CREATE Conflict {
  type: "competing_p0",
  team: team_scope,
  stakeholders: [A.user_id, B.user_id],
  p0s: [A.p0_submission.text, B.p0_submission.text],
  detected_at: NOW(),
  status: "active"
}
```

**Conflict lifecyle:**

| State | Description | Entry condition |
|-------|-------------|-----------------|
| `active` | Newly detected, unresolved | Created by Rule 1 |
| `acknowledged` | Seen by a required approver | Manual acknowledge action |
| `resolved` | Stakeholders agree on priority | Manual resolve with resolution note |
| `expired` | >48h in `active` without acknowledgment | Automatic timeout |

**Extensibility:** The rule engine MUST support adding new rules (e.g., "same stakeholder submits conflicting P0s across teams") without modifying existing rule logic. Rules are registered in a `conflict_rules` registry by ID, name, and `evaluate()` function.

**Trigger conditions:**
- On every P0 submission (synchronous evaluation)
- On every diagnostic run (batch evaluation of all active stakeholders)

**Effect on scoring:** Any `active` or `acknowledged` conflict in `active_conflicts[]` blocks the stakeholder_alignment score from being `Green` (≥0.80). The score is capped at `Yellow` (0.50–0.79) if any conflict exists.

#### Conflict Cases (per AC-506)

| Case | Stakeholders | P0s | Team scope | Within review window? | Expected result |
|------|-------------|-----|-----------|---------------------|----------------|
| A | user_1: "Ship auth v2" | user_2: "Refactor payments" | platform | Yes (3d < 7d) | **Active conflict created** |
| B | user_1: "Ship auth v2" | user_2: "Ship auth v2" | platform | Yes | No conflict (same P0 text) |
| C | user_1: "Ship auth v2" | user_2: "Refactor payments" | platform | No (10d > 7d) | No conflict (outside window) |
| D | user_1: "Ship auth v2" | user_2: "Refactor payments" | platform | Yes, but user_2.is_active=false | No conflict (inactive stakeholder) |
| E | user_1: "Ship auth v2" | user_2: "Refactor payments" | governance | Yes | No conflict (different team_scope) |

---

### FR-6: Sign-off Protocol State Machine (Task 507)

**States and transitions:**

```
                  ┌──────────────────────────────────────────────┐
                  │                                              │
                  v                                              │
  ┌──────┐   submit    ┌──────────────┐  approve   ┌──────────┐ │
  │Draft │────────────>│PendingReview │───────────>│ Approved │ │
  └──────┘             └──────────────┘            └──────────┘ │
                              │                                   │
                    ┌─────────┼──────────┐                       │
                    v         v          v                       │
             ┌──────────┐ ┌──────────┐ ┌───────────┐            │
             │ Approved │ │Approved  │ │  Blocked  │────────────┘
             │  w/Comm  │ │  (same)  │ └─────┬─────┘
             └──────────┘            │       │
                        ┌────────────┘       │
                        v                    v
                  ┌──────────────┐   ┌──────────────┐
                  │  Escalated   │<──│  (auto on     │
                  │  (L1/L2/L3)  │   │   Block)      │
                  └──────┬───────┘   └──────────────┘
                         │
                 ┌───────┴────────┐
                 v                v
           ┌──────────┐    ┌──────────┐
           │ Resolved │    │ Expired  │
           └──────────┘    └──────────┘
```

**Transition table:**

| Current State | Action | Next State | Conditions | Requires |
|--------------|--------|-----------|------------|---------|
| Draft | `submit_for_review` | PendingReview | All required approvers assigned | — |
| PendingReview | `approve` | Approved | Signer is `is_required_approver` | — |
| PendingReview | `approve_with_comment` | ApprovedWithComment | Signer is `is_required_approver` | Comment text |
| PendingReview | `block` | Blocked | Signer is `is_required_approver` | Block reason |
| PendingReview | *(timeout >48h)* | *(stays PendingReview)* | — | Flag overdue, trigger reminder (FR-7) |
| Blocked | *(auto)* | Escalated | Automatic on enter Blocked | — |
| Approved | *(none)* | — | Terminal state | — |
| ApprovedWithComment | *(none)* | — | Terminal state (comments logged) | — |
| Escalated | `resolve` | Resolved | Final resolution note | Resolution text |
| Escalated | *(timeout all levels)* | Expired | All escalation levels exhausted | — |
| Expired | *(none)* | — | Terminal state, notifies Diagnostic Runner | — |

**48-hour rule:** If a sign-off remains in `PendingReview` for >48 hours without a transition, the system MUST:
1. Flag the item as **overdue**
2. Set Q4 to `Yes` (overdue sign-off exists)
3. Trigger the escalation reminder mechanism (FR-7)

---

### FR-7: Escalation Path and Reminders (Task 507)

**Escalation chains:**

Each team/project MUST have a configurable escalation chain with up to 3 levels:

```json
{
  "project_id": "uuid",
  "escalation_chain": {
    "L1": {
      "role": "director_product",
      "users": ["user_id_1", "user_id_2"],
      "sla_hours": 72
    },
    "L2": {
      "role": "vp_engineering",
      "users": ["user_id_3"],
      "sla_hours": 72
    },
    "L3": {
      "role": "cto",
      "users": ["user_id_4"],
      "sla_hours": 72
    }
  }
}
```

**SLA:** 3 calendar days (72 hours) per level. The SLA clock starts within 15 minutes of the escalation trigger (enter `Blocked` state).

**Reminder schedule:**

| Timing | Action |
|--------|--------|
| At escalation trigger | Notify L1 assignees |
| T + 48h (24h before L1 deadline) | Reminder to L1 assignees |
| T + 68h (4h before L1 deadline) | Final reminder to L1 assignees |
| T + 72h (L1 deadline met) | Escalate to L2; notify L2, CC L1 |
| T + 120h (24h before L2 deadline) | Reminder to L2 assignees |
| T + 140h (4h before L2 deadline) | Final reminder to L2 assignees |
| T + 144h (L2 deadline met) | Escalate to L3; notify L3, CC L2 |
| T + 216h (L3 deadline met) | Move to `Expired`; notify Diagnostic Runner |

**Logging:** Every escalation event (trigger, reminder, escalation, resolution, expiry) MUST be logged to the health profile's `escalation_events[]` array:

```json
{
  "event_type": "escalated_to_L2",
  "occurred_at": "2026-07-15T14:00:00Z",
  "from_level": "L1",
  "to_level": "L2",
  "notified_users": ["user_id_3"],
  "reason": "L1 SLA expired without resolution"
}
```

---

### FR-8: Reporting Dashboard & Weekly Digests (Task 508)

#### Dashboard Metrics

| Metric | Formula | Source |
|--------|---------|--------|
| **Alignment Score** | Weighted sum of answered questions (0–100) | HealthProfile.category_scores.stakeholder_alignment |
| **Active Conflicts** | COUNT(conflicts WHERE status IN ('active','acknowledged')) | HealthProfile.active_conflicts |
| **Overdue Sign-offs (>48h)** | COUNT(sign_offs WHERE state='PendingReview' AND duration >48h) | Sign-off state machine |
| **Approver Coverage %** | (active_approvers / total_required_approvers) × 100 | StakeholderMap |
| **Escalation Rate** | escalations_last_30d / total_signoffs_last_30d | Escalation log |
| **Avg Time to Sign-off** | AVG(resolved_at - submitted_at) for last 30 days | Sign-off audit log |

**Filters:** Project, team_scope, time window (7d/30d/90d/custom), escalation status.

**Cache:** Dashboard metrics SHOULD be cached for 60 seconds to avoid recomputation on every load.

#### Weekly Digest Template

```json
{
  "digest_id": "uuid",
  "project_id": "uuid",
  "generated_at": "2026-07-19T08:00:00Z",
  "period_start": "2026-07-12T00:00:00Z",
  "period_end": "2026-07-18T23:59:59Z",
  "alignment_score": 72,
  "alignment_trend": "improving",
  "active_conflicts": [
    {
      "conflict_id": "uuid",
      "team": "platform",
      "stakeholders": ["user_1", "user_2"],
      "p0s": ["Ship auth v2", "Refactor payments"],
      "detected_at": "2026-07-14T09:00:00Z",
      "age_hours": 96
    }
  ],
  "overdue_signoffs": [
    {
      "signoff_id": "uuid",
      "team": "platform",
      "stakeholder": "user_3",
      "submitted_at": "2026-07-13T10:00:00Z",
      "overdue_hours": 70
    }
  ],
  "escalations": [
    {
      "escalation_id": "uuid",
      "level": "L2",
      "team": "platform",
      "triggered_at": "2026-07-16T14:00:00Z",
      "status": "active"
    }
  ],
  "new_this_week": {
    "conflicts": 1,
    "signoffs": 5,
    "escalations": 1
  },
  "action_items": [
    "Resolve competing P0s on platform team (96h active)",
    "Review overdue sign-off from user_3 (70h)"
  ]
}
```

**Delivery:** The digest MUST be generated by a scheduled (cron daily) worker and distributed via:
- Email (configurable recipient list)
- Slack webhook (configurable channel)

**Minimum fields per AC-508:** alignment score, active conflicts list, overdue >48h list, escalations list, alignment trend.

---

## 5. Data Model Summary

### Entity Relationship

```
Project
  └── HealthProfile (1:1)
        ├── category_scores
        ├── answers[]
        ├── active_conflicts[]
        ├── approver_coverage_pct
        ├── escalation_status
        └── version
  └── StakeholderMap (1:1)
        ├── stakeholders[]
        │     ├── p0_submission (optional)
        │     └── confirmation metadata
        ├── review_window_days
        └── last_reviewed_at
  └── SignOffProtocol (1:N)
        ├── state (Draft|PendingReview|Approved|...)
        ├── responses[]
        └── escalation_chain
  └── WeeklyDigest (1:N)
        ├── alignment_score
        ├── conflicts[]
        ├── overdue_signoffs[]
        ├── escalations[]
        └── action_items[]
```

### Core Types (TypeScript interfaces)

```typescript
interface QuestionResponse {
  question_id: string;
  answer: boolean;
  evidence_link: string;
  answered_by: string;
  answered_at: string; // ISO 8601
  notes?: string;
}

interface HealthProfile {
  project_id: string;
  category_scores: Record<string, number>;
  answers: QuestionResponse[];
  last_run_at: string;
  active_conflicts: ConflictSummary[];
  approver_coverage_pct: number;
  escalation_status: 'none' | 'active' | 'expired';
  version: number;
}

interface Stakeholder {
  user_id: string;
  role: string;
  is_required_approver: boolean;
  team_scope: string;
  p0_submission?: P0Submission;
  is_active: boolean;
  confirmed_at: string;
  last_activity_at: string;
}

interface P0Submission {
  p0_id: string;
  text: string;
  submitted_at: string;
}

interface Conflict {
  conflict_id: string;
  type: 'competing_p0';
  team: string;
  stakeholders: string[];
  p0s: string[];
  detected_at: string;
  status: 'active' | 'acknowledged' | 'resolved' | 'expired';
  resolved_at?: string;
  resolution_note?: string;
}

interface SignOffState {
  signoff_id: string;
  project_id: string;
  state: 'Draft' | 'PendingReview' | 'Approved' | 'ApprovedWithComment' | 'Blocked' | 'Escalated' | 'Resolved' | 'Expired';
  responses: SignOffResponse[];
  escalation_chain: EscalationChain;
  submitted_at: string;
  overdue_since?: string;
}

interface SignOffResponse {
  user_id: string;
  response_type: 'approve' | 'approve_with_comment' | 'block';
  comment?: string;
  responded_at: string;
}

interface EscalationChain {
  L1: EscalationLevel;
  L2: EscalationLevel;
  L3: EscalationLevel;
}

interface EscalationLevel {
  role: string;
  users: string[];
  sla_hours: number;
}
```

---

## 6. Acceptance Criteria

### AC-504 (Canonical Questions, Branching, HealthProfile)
- 5 canonical questions defined with IDs, text, type, weight, and required_evidence
- Branching rules documented for Q1→Q2, Q4→conflict scan, Q3→remediation
- `HealthProfile` JSON schema defined with all required fields (project_id, category_scores, answers, last_run_at, active_conflicts, approver_coverage_pct, escalation_status, version)
- Score calculation formula defined (weighted sum with re-normalisation)

### AC-505 (Stakeholder Map)
- Stakeholder Map schema supports: user_id, role, is_required_approver, team_scope, p0_submission (p0_id, text, submitted_at), is_active, confirmed_at, last_activity_at
- review_window_days parameter with default of 7
- Staleness detection: stale if confirmed_at > 30 days OR user deactivated

### AC-506 (Conflict Detection)
- Rule 1 correctly identifies Case A (different P0s, same team, within window → active conflict)
- Rule 1 correctly excludes Case B (same P0 → no conflict)
- Rule 1 correctly excludes Case C (outside window → no conflict)
- Rule 1 correctly excludes Case D (inactive stakeholder → no conflict)
- Rule 1 correctly excludes Case E (different team_scope → no conflict)
- Active conflicts block alignment score from being Green

### AC-507 (Sign-off State Machine & Escalation)
- State machine diagram with 8 states and all transitions
- Transition table covers: submit_for_review, approve, approve_with_comment, block, auto-escalate, resolve, timeout → expired
- 48-hour rule: >48h in PendingReview flags overdue, triggers Q4=Yes
- Escalation SLA: 3 days per level (L1, L2, L3)
- Reminder schedule: 24h and 4h before per-level deadline
- Escalation event logging schema defined

### AC-508 (Reporting Dashboard & Weekly Digest)
- 6 dashboard metrics defined with formulas and sources
- Digest template includes: alignment_score, alignment_trend, active_conflicts[], overdue_signoffs[], escalations[], new_this_week, action_items[]
- Digest delivery via email and Slack webhook (configurable)
- 60-second cache for dashboard metrics

---

## 7. Dependencies

| Sub-task | Depends On | Description |
|----------|-----------|-------------|
| #504 (Questions, HealthProfile) | — | Foundational; no internal dependencies |
| #505 (Stakeholder Map) | — | Independent of #504 |
| #506 (Conflict Detection) | #505 | Requires stakeholder map with P0 submissions |
| #507 (Sign-off & Escalation) | #505, #506 | Requires stakeholder map for approvers, conflict detection for Block trigger |
| #508 (Reporting & Digests) | #504, #505, #506, #507 | Consumes data from all four upstream tasks |

---

## 8. Sub-task Summaries

| ID | Title | Description | Deliverables |
|----|-------|-------------|-------------|
| #504 | Canonical Questions, Branching Logic, Health Profile Schema | Define 5 canonical questions, branching rules, and HealthProfile JSON schema | Question spec, branching logic doc, HealthProfile schema |
| #505 | Stakeholder Map & Required Approvers Registry | Define stakeholder map schema with P0 submission, approver flag, staleness detection | StakeholderMap schema, staleness rules |
| #506 | Conflict Detection Rules Engine | Implement Rule 1 (competing P0s) with extensible registry, 5 test cases | Rule spec, conflict schema, test case table |
| #507 | Sign-off Protocol State Machine & Escalation Path + Reminders | State machine with 8 states, escalation chains, SLA, reminder schedule | State machine diagram, transition table, escalation chain schema, reminder schedule |
| #508 | Reporting Dashboard (metrics) & Weekly Digests | 6 dashboard metrics, weekly digest template, delivery config | Metrics formulas, digest template, delivery spec |

---

## 9. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-07-12 | Validator | Initial spec — canonical questions, branching, data models, conflict rules, state machine, escalation, reporting |

*This is a first-pass spec. Implementation details (API endpoints, DB migrations, UI components) are deferred to the code-implementation turn.*