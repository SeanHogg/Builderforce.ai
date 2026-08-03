> **PRD** — drafted by Ada (Sr. Product Mgr) · task #768
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document for Epic #709 Manifest Owner Assignment

## Problem & Goal
When a manifest is generated from an epic, the ownership and lifecycle state are not automatically derived from the epic’s assignment fields. This forces manual updates, increases error risk, and slows down downstream processes that depend on accurate owner and state information.

**Goal:** Automatically set the manifest’s `Owner` field to the assigned agent’s identifier (`Ada`) and the `state` field to `assigned` whenever Epic #709 has either `assignedAgentRef = "Ada"` or `assignedUserId = "Ada"`.

## Target Users / ICP Roles
- DevOps engineers generating deployment manifests from work tracking epics.
- Project managers or release coordinators who rely on accurate manifest metadata for audit trails.
- Platform administrators who configure automated manifest pipelines.

## Scope
- **In scope:** Epic #709 manifest generation logic when `assignedAgentRef` or `assignedUserId` equals the exact string `"Ada"`.
- **In scope:** Setting exactly two manifest metadata fields: `Owner` (value `"Ada"`) and `state` (value `"assigned"`).
- **Trigger condition:** OR logic – if either assignment reference resolves to `"Ada"`, the rule applies.

## Functional Requirements
1. **Detection**  
   The manifest generation service SHALL inspect Epic #709 for the presence of `assignedAgentRef` and `assignedUserId`.
   - If either value string‑equals `"Ada"` (case‑sensitive), the rule is triggered.

2. **Owner Mapping**  
   When the rule triggers, the generated manifest’s `Owner` metadata field SHALL be set to `"Ada"`.

3. **State Mapping**  
   When the rule triggers, the manifest’s `state` field SHALL be set to `"assigned"`.

4. **No Overlap Conflict**  
   If both `assignedAgentRef` and `assignedUserId` are present and both equal `"Ada"`, the same result SHALL be produced without duplication or error.

5. **Non‑Triggering Cases**  
   If neither field equals `"Ada"` (e.g., other users, empty or missing fields), the rule SHALL NOT apply; existing default manifest generation behaviour SHALL remain unchanged.

## Acceptance Criteria
| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | Epic #709 has `assignedAgentRef = "Ada"` and no `assignedUserId` | Manifest `Owner` = `"Ada"`, `state` = `"assigned"` |
| 2 | Epic #709 has `assignedUserId = "Ada"` and no `assignedAgentRef` | Manifest `Owner` = `"Ada"`, `state` = `"assigned"` |
| 3 | Epic #709 has `assignedAgentRef = "Ada"` **and** `assignedUserId = "Ada"` | Manifest `Owner` = `"Ada"`, `state` = `"assigned"` (no duplicates) |
| 4 | Epic #709 has `assignedAgentRef = "Other"` or `assignedUserId = "Other"` | Manifest `Owner` and `state` follow existing defaults; not overwritten |
| 5 | Epic #709 has both fields missing or null | Manifest generation proceeds with no change to `Owner`/`state` |

## Out of Scope
- Other epics, tasks, or work items; this rule applies strictly to Epic #709.
- Dynamic mapping from arbitrary agent/user identifiers – only the literal `"Ada"` is handled.
- Updates to the manifest after initial generation (no listening for assignment changes).
- Any user interface changes; this is a pure backend data mapping.
- Additional manifest fields beyond `Owner` and `state`.
- Rollback or migration of previously generated manifests.

## Requirements

> _Authored by the Business Analyst_

### REQ-001 — Epic Identification
The system SHALL identify the target epic by its immutable identifier `709`. The rule SHALL NOT apply to any other epic, task, or work item, regardless of similarity in assignment data.

**Rationale:** Scoping to a single epic eliminates ambiguity and prevents unintended side effects on unrelated manifests. A hardcoded identifier is acceptable because the rule is explicitly bounded to Epic #709 per the scope statement.

**Traceability:** Satisfies Functional Requirement #1 (Detection), Acceptance Criteria #1-#5.

---

### REQ-002 — Assignment Field Inspection
The system SHALL read exactly two fields from the `tasks` table for Epic #709: `assignedAgentRef` (VARCHAR, nullable) and `assignedUserId` (VARCHAR, nullable). No other assignment-related columns (e.g., `assignedAgentHostId`, `assignedAgentType`) SHALL be consulted.

**Rationale:** The `assignedAgentRef` field holds the `ide_agents.id` of a cloud agent, and `assignedUserId` holds the `users.id` of a human assignee. These are the two canonical assignment paths. Restricting the inspection to these two fields prevents false triggers from auxiliary assignment metadata.

**Traceability:** Satisfies Functional Requirement #1 (Detection).

---

### REQ-003 — Case-Sensitive String Equality
The comparison SHALL use exact, case-sensitive string equality (`=== "Ada"`). Values such as `"ada"`, `"ADA"`, `" Ada "`, or `"Ada "` SHALL NOT trigger the rule.

**Rationale:** Case-sensitive matching is the safest default for identifier comparison and avoids ambiguity. The literal `"Ada"` is a specific agent identifier string; deviation from this value indicates a different assignee.

**Traceability:** Satisfies Functional Requirement #1 (Detection), Acceptance Criteria #4.

---

### REQ-004 — OR-Trigger Logic
The trigger condition SHALL evaluate as: `assignedAgentRef === "Ada" || assignedUserId === "Ada"`. If either field matches, the rule fires. If both match, the rule fires exactly once (no duplicate processing).

**Rationale:** The OR condition ensures the rule fires whether Ada is assigned as a cloud agent (`assignedAgentRef`) or as a human user (`assignedUserId`), covering the full assignment surface.

**Traceability:** Satisfies Functional Requirement #4 (No Overlap Conflict), Acceptance Criteria #1-#3.

---

### REQ-005 — Manifest Owner Assignment
When the rule triggers, the generated manifest's `Owner` metadata field SHALL be set to the string literal `"Ada"`. This assignment SHALL occur exactly once per manifest generation event.

**Rationale:** The `Owner` field is the manifest's authoritative ownership record. Setting it to `"Ada"` downstream consumers (audit trails, deployment pipelines, compliance checks) can unambiguously identify the responsible party.

**Traceability:** Satisfies Functional Requirement #2 (Owner Mapping), Acceptance Criteria #1-#3.

---

### REQ-006 — Manifest State Assignment
When the rule triggers, the manifest's `state` field SHALL be set to the string literal `"assigned"`. This assignment SHALL occur exactly once per manifest generation event.

**Rationale:** The `state` field communicates lifecycle readiness. A manifest in `"assigned"` state signals that ownership has been resolved and the manifest is ready for downstream processing. This eliminates the manual step of setting the state after generation.

**Traceability:** Satisfies Functional Requirement #3 (State Mapping), Acceptance Criteria #1-#3.

---

### REQ-007 — Non-Trigger Passthrough
If neither `assignedAgentRef` nor `assignedUserId` equals `"Ada"` — including cases where both fields are `null`, undefined, empty strings, or any other value — the system SHALL NOT modify the manifest's `Owner` or `state` fields. The existing default manifest generation behaviour SHALL proceed unchanged.

**Rationale:** The rule is additive, not transformative. It overlays ownership and state only when the specific trigger condition is met; in all other cases, the manifest generation pipeline retains full control.

**Traceability:** Satisfies Functional Requirement #5 (Non-Triggering Cases), Acceptance Criteria #4-#5.

---

### REQ-008 — Single Manifest Generation Hook
The rule SHALL be applied during manifest generation only. It SHALL NOT poll for assignment changes or retroactively update previously generated manifests. If Epic #709's assignment changes after manifest generation, the manifest retains its original `Owner` and `state` values until the next generation event.

**Rationale:** This constraint bounds the rule to the generation path, keeping it simple and predictable. A manifest is a point-in-time artifact; consumers that need up-to-date ownership can re-trigger generation.

**Traceability:** Aligns with Out of Scope ("Updates to the manifest after initial generation").

---

### REQ-009 — Idempotency
The rule SHALL produce identical results when invoked multiple times with the same input data. Repeated manifest generation for Epic #709 with the same assignment fields SHALL yield the same `Owner` and `state` values.

**Rationale:** Idempotency is critical for automated pipelines that may re-trigger manifest generation (e.g., on retry, on schedule, or on upstream dependency change). Non-idempotent behaviour would cause unpredictable state drift.

**Traceability:** Derived from Functional Requirement #4 (No Overlap Conflict).

---

### REQ-010 — No Side Effects
The rule SHALL NOT modify the `tasks` table, the Epic #709 record, or any other persistent state. It SHALL NOT emit events, notifications, or log entries beyond the manifest generation pipeline's standard logging. Its sole effect is setting two fields on the generated manifest artifact.

**Rationale:** A data-mapping rule with side effects is a source of bugs and audit anomalies. Keeping the rule purely transformational ensures it can be tested, rolled back, and reasoned about in isolation.

**Traceability:** Aligns with Out of Scope and the non-functional expectation of minimal blast radius.

---

### REQ-011 — Zero Additional Latency
The string comparison and field assignment SHALL add negligible overhead to manifest generation — well under 1 ms in practical terms. The rule SHALL NOT introduce any I/O beyond what the manifest generation pipeline already performs (the Epic #709 record is already loaded during generation).

**Rationale:** Manifest generation is on the critical path for deployment pipelines. The rule is a pure in-memory conditional on already-loaded data; any measurable latency impact would indicate an implementation defect.

**Traceability:** Non-functional requirement; ensures the rule does not degrade pipeline throughput.

---

### Requirements Traceability Matrix

| REQ | Functional Requirement | Acceptance Criteria |
|-----|----------------------|---------------------|
| REQ-001 | FR #1 Detection | AC #1-#5 |
| REQ-002 | FR #1 Detection | AC #1-#5 |
| REQ-003 | FR #1 Detection | AC #4 |
| REQ-004 | FR #4 No Overlap | AC #1-#3 |
| REQ-005 | FR #2 Owner Mapping | AC #1-#3 |
| REQ-006 | FR #3 State Mapping | AC #1-#3 |
| REQ-007 | FR #5 Non-Triggering | AC #4-#5 |
| REQ-008 | Out of Scope | — |
| REQ-009 | FR #4 No Overlap | — |
| REQ-010 | Out of Scope | — |
| REQ-011 | — | — |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._