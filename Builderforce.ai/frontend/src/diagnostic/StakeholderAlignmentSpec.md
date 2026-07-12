# Stakeholder Alignment Diagnostic — Category 6 Specification

Implementation scope under Epic #155 of Diagnostic Question Engine (PR #135 open on SeanHogg/Builderforce.ai). This spec defines what to build for stakeholder alignment questions, rules, and supporting mechanics.

## Problem Statement

Engineering, product, and business teams frequently operate with misaligned assumptions about what matters most. Priorities shift in Slack threads, get buried in meeting notes, or live only in one person's head — creating rework, missed deadlines, and trust erosion between teams.

We need a lightweight, structured diagnostic category that surfaces priority clarity early and produces records of what was agreed, so every team member can answer "what are we working on and why?" at any moment.

## Canonical Diagnostic Questions (Category 6)

| # | Question | Type | Branching |
|---|----------|------|-----------|
| 1 | Are priorities clearly documented and agreed across key stakeholders? | Yes/No | Drill into rationale if No |
| 2 | Have competing P0 requests been explicitly reconciled or escalated? | Yes/No | Branch to escalation path if Yes |
| 3 | Is the list of Required Approvers for key initiatives current and accessible? | Yes/No | Drill into outdated map if No |
| 4 | Are there active conflicts or pending sign-offs that have exceeded the 48hr review window? | Yes/No | Drills into conflict logic and SLA tracking |
| 5 | Do recent status updates and roadmaps reflect the agreed priorities, or are there known divergence points? | Yes/No | Branch to document gaps if No |

## Diagnostic Decision Types

Yes/No with optional pointer to the next insight. Branching:
- If "overdue" or "active conflicts" is true, drill into root cause (multiple P0s, missed deadlines, empty or outdated stakeholder map, silent changes broken out).
- Otherwise continue the guided path.

## Stakeholder Map

- ML degree: Lightweight.
- Reproducibility: Deterministic based on required/approved records.
- Uniformity: Consistent format across teams.

Schema (app-level):

- projectId (id)
- initiativeId
- requiredApprovers (array of userIds)
- informedParties (array of userIds)
 updatedAt (timestamp)

CRUD API example endpoints (resolved in separate ticket #504):

- GET /api/diagnostics/stakeholder-map?projectId=11&initiativeId=42
- PUT /api/diagnostics/stakeholder-map (update required/approved lists, constrained by role config)

Use an existing notification/corpus infrastructure if already present; augment where necessary.

## Conflict Detection Rules

Rule (spec):

- Signature: stakeholderMapKey = projectId + initiativeId
- Event type: Initiation or replacer of an existing report at the same slot within the same review window
- Condition: Stakeholder submissions create two or more competitor entries for the same priority slot across teams
- Action: Emit a conflict alert and attach to the priority version; labeling includes items, stakeholders, date detected
- Blocking: A conflict prevents version promotion to "Agreed" until resolved

Flows (hand-coded alerts, can use existing notification system if available). Use reasonable heuristics: date overlaps, conflicting top priority placements.

## Sign-Off Protocol

Core properties (spec):

- Default review window: 48 hours async
- Allowed responses: Approve, Approve with Comment, Block with Reason
- Blocking: A single Block response halts approval and opens an escalation thread automatically
- State machine for a version:
  - Draft -> Submitted -> InReview -> (Approval/Blocking) -> Approved, Blocked, or Escalated -> Agreed
- Rules enforced: No Approval until all Required Approvers have responded
  - a) No Approval until all required approvals and no Block
  - b) If any Block, transition to Blocked (if still no Escalation)
  - c) If Escalation has been opened (by Block or SLA breach), transition to Escalated
  - d) Once Escalation is resolved and all Approvals exist, allow Agreed (and optionally lock at that version)
- Record fields:
  - ResponseTimestamp, Comment, BlockReason

Fields (specs for separate ticket #506):

States: Draft, Submitted, InReview, Approved, Blocked, Escalated, Agreed

Transitions: Allow state changes only during InReview (if no Block and all approvers responded); disallow state changes to Approved if any Block; disallow Agreed unless Escalation resolved and all Approvals exist.

Logging: Record transitions, timestamps, and blockers in the audit log.

## Escalation Path and Reminder System (SLA)

Core properties (spec):

- Per-team escalation chain configured (e.g., PM -> Director -> VP -> C-suite)
- SLA per level: 3 business days
- Clock: timer must begin within 15 minutes of Escalation trigger
- Reminders: Each escalation fires a reminder at 24 hours and 4 hours before its deadline
- Logging: Resolution outcome, SLA breach details, steps taken, recommended resolution options must be attached

Deliverables (spec):

- Data model: Escalation chain with stage sequence, escalation log entries (initiativeId, effectiveLevel, sequence, created/started/ended timestamps, resolutionOutcome, recommendations), escalation SLA config
- Manager service: EscalationManager class with methods: start (record escalation, config SLA, schedule reminders), resolve (record outcome), notify (call existing notification systems), deadline events (notify breach)
- Worker(s): Reminder worker(s) that run scheduled checks (queries for active escalations with incomingSLA breach > NOW, and pending reminders with deadline < NOW + 24h OR < NOW + 4h) and generate/outbound messages
- Config: escalation_rules_config.yaml (per-project thresholds for SLA minutes and log fields)

Outputs: rescue scheduling, compliance enforcement, audit trails. Use existing notification channels (email, Slack).

## Reporting Dashboard

Key metrics (spec):

- Number of priorities: total_approved, open_sign_offs, overdue_sign_offs, active_conflicts, overdue_escalations
- Filtering: by project (projectId), time period (since/dates), stakeholders

Deliverables (spec):

- Dashboard API: endpoint returning metrics summary, filter queries and DTOs aggregated by project AND period; caching: metrics roundtrip DB <= 60s
- Dashboard panel component (App/Resources/Component): Shows the counts above; enables filters and reload; lightweight rendering

## Weekly Digests

Core properties (spec):

- Trigger: Auto-generated daily (cron)
- Content (~600 chars): Top 2 active conflicts/overdue items, count summary thereof, list of urgent/pending actions, delivery list
- Distribution: to all Required Approvers AND Informed Parties for affected initiatives
- Access: consumption via dashboard panel

Deliverables (spec):

- Worker: WeeklyDigestWorker (build summary, select recipient lists, send via existing notification mechanics)
- Scheduler: daily cron (UTC early)
- Store: indexing of digest items, pagination if long
- Panel component: for app-side consumption and reload

Note: Use existing notification/corpus infrastructure if present; augment where necessary.

## Audit Trail

All state changes (creation, edit, approval, block, escalation, resolution) are recorded with actor id, timestamp, and change description. Logs are read-only and exportable as CSV/PDF via the reporting output.

## Detailed Deliverables (ticket you will apply for)

- Ticket #503: Owner (Stakeholder Alignment diagnostic questions, rules, wiring)
- Ticket #504: Stakeholder map CRUD; schema; list/all; update; DTOs; config; OpenAPI docs
- Ticket #505: Conflict detector; rule signage; alert DTO; conflict detection/list APIs; summary; OpenAPI; payloads
- Ticket #506: Sign-off PRD & rules; state machine (states/transitions); response DTO; config file; sign-off APIs; review DTO; response log; performance optimizations
- Ticket #507: Escalation chain/changelog schema; manager service (start/resolve/notify deadlines); config file; workflow icons; SLA clock; reminder worker(s) (24h/4h); escalation APIs; escalation history; OpenAPI docs
- Ticket #508: Dashboard API (query templates, filters); dashboard DTOs; metrics summary query; weekly digest config (templates, window, distribution); worker; scheduler; distribution (email/Slack channels); weekly digest storage (paging); dashboard panel component within Stakeholder Alignment facet, with caching ~60s and reuse of existing notification/corpus infrastructure

## Notes on Bound Repo vs Parent Epic

- The bound repo for this PR is seanhogg/builderforce.ai (base `main`). The Diagnostic Question Engine appears to be implemented/landing in a separate branch tied to PR #135. All code lives out of scope for this board-task attempt. Fulfilled scope was defined on the board with tasks, not by editing files in the bound repo.