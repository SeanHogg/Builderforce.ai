> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #324
> _Each agent that updates this PRD signs its change below._

# PRD: Accept/Reject Recommendations with Automated Workflow Triggers

## Problem & Goal

Users currently receive AI-generated or system-generated recommendations but have no structured way to act on them directly within the product. Recommendations are passive — they surface insights but require users to manually execute follow-up actions in disconnected tools or processes. This creates friction, delays action, and breaks the feedback loop that would allow the system to learn from user decisions.

**Goal:** Provide users with a first-class accept/reject interaction model on recommendations, where each decision optionally triggers one or more predefined automated workflows — turning passive insights into executable, trackable actions.

---

## Target Users / ICP Roles

| Role | Context |
|---|---|
| **Operations Managers** | Act on process optimization recommendations; trigger downstream task assignments or escalations |
| **Data Analysts / Decision Makers** | Accept analytical recommendations that kick off reporting pipelines or data transformations |
| **Product Managers** | Accept/reject prioritization or roadmap recommendations; trigger backlog updates or notifications |
| **System Administrators** | Configure which workflows are bound to which recommendation types |
| **Developers / Integration Engineers** | Build and register automated workflows that connect to the recommendation engine via webhooks or internal APIs |

---

## Scope

This PRD covers the end-to-end lifecycle of a recommendation decision:

1. Surfacing a recommendation to a user with actionable controls
2. Capturing an explicit accept or reject decision (with optional rationale)
3. Triggering bound automated workflows based on the decision
4. Tracking and auditing the decision and workflow execution status

**In scope for v1:**
- Accept and Reject actions on individual recommendations
- Optional free-text rationale field on any decision
- Workflow binding configuration (admin-level) per recommendation type
- Synchronous and asynchronous workflow trigger support
- Decision audit log
- Status feedback to the user (workflow triggered, succeeded, failed)

---

## Functional Requirements

### FR-1: Recommendation Display
- Each recommendation must display a summary, confidence level or source, and the two primary actions: **Accept** and **Reject**.
- Recommendations must support a detail expansion view (modal or panel) showing full context before a decision is made.
- Recommendations in a terminal state (accepted/rejected) must visually indicate their resolved status and be non-editable unless explicitly reopened (see FR-6).

### FR-2: Accept Action
- Clicking **Accept** must:
  1. Prompt the user for an optional rationale (max 500 characters).
  2. Record the decision with timestamp, user ID, recommendation ID, and rationale.
  3. Transition the recommendation to `Accepted` state.
  4. Trigger all workflows bound to the `on_accept` event for that recommendation type (see FR-4).

### FR-3: Reject Action
- Clicking **Reject** must:
  1. Prompt the user for an optional rationale (max 500 characters).
  2. Record the decision with timestamp, user ID, recommendation ID, and rationale.
  3. Transition the recommendation to `Rejected` state.
  4. Trigger all workflows bound to the `on_reject` event for that recommendation type (see FR-4).

### FR-4: Workflow Binding & Triggering
- Admins must be able to bind one or more workflows to each recommendation type for each event (`on_accept`, `on_reject`, or `on_either`).
- Supported trigger mechanisms:
  - **Webhook:** POST request to a configured URL with a standard JSON payload.
  - **Internal workflow engine:** Invoke a named internal workflow with a defined input schema.
- The trigger payload must include: `recommendation_id`, `recommendation_type`, `decision` (`accepted` | `rejected`), `decided_by`, `decided_at`, `rationale`, and `recommendation_metadata`.
- Workflow execution must be non-blocking for the user; UI confirms trigger initiation immediately.
- Failed workflow triggers must be retried up to 3 times with exponential backoff before marking as `Failed`.

### FR-5: Workflow Execution Status Feedback
- After a decision, the UI must display the execution status of each bound workflow:
  - `Triggered` → `Running` → `Succeeded` / `Failed`
- Users must be able to view workflow status inline on the recommendation card and in the detail view.
- On `Failed` status, the system must surface an error summary and a manual **Retry** option (available to the deciding user and admins).

### FR-6: Decision Amendment
- An accepted or rejected recommendation may be reopened to `Pending` state by a user with the appropriate permission (e.g., the original decider or an admin).
- Reopening must record an amendment log entry with reason and actor.
- Reopening a recommendation does **not** automatically reverse any previously triggered workflows; a warning must be displayed to the user stating this explicitly.

### FR-7: Bulk Accept / Reject
- Users must be able to select multiple recommendations of the same type and apply an Accept or Reject action in bulk.
- Bulk actions must apply a single shared rationale or allow per-item rationale (user's choice).
- Bulk workflow triggers must be queued and executed asynchronously, with aggregate status shown on a bulk operation status panel.

### FR-8: Audit Log
- Every decision event must be written to an immutable audit log capturing: `actor`, `action`, `recommendation_id`, `timestamp`, `rationale`, `workflow_trigger_ids[]`.
- Audit log must be viewable by admins with filter and export (CSV) capabilities.
- Audit entries must be retained for a minimum of 2 years.

### FR-9: Notifications
- Decision actors must receive an in-app confirmation notification after a decision is recorded.
- Stakeholders subscribed to a recommendation (or recommendation type) must receive a notification when a decision is made.
- If a workflow fails after all retries, the deciding user and all admins must be notified via in-app notification and email.

### FR-10: Permissions & Access Control
- Role-based controls must govern who can: view recommendations, make decisions, configure workflow bindings, retry failed workflows, amend decisions, and access the audit log.
- Minimum roles: `viewer`, `decider`, `admin`.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A user with the `decider` role can accept or reject any recommendation visible to them, and the recommendation transitions to the correct terminal state immediately. |
| AC-2 | Upon accepting a recommendation, all workflows bound to `on_accept` for that recommendation type are triggered within 5 seconds of the user confirming the action. |
| AC-3 | Upon rejecting a recommendation, all workflows bound to `on_reject` for that recommendation type are triggered within 5 seconds of the user confirming the action. |
| AC-4 | The rationale field is optional; a decision can be submitted without it and is still valid. |
| AC-5 | Workflow execution status updates are reflected in the UI within 10 seconds of a status change event. |
| AC-6 | A failed workflow trigger is retried exactly 3 times before status is set to `Failed`, and the user and admins are notified. |
| AC-7 | The manual Retry action re-triggers the failed workflow and resets its status to `Triggered`. |
| AC-8 | Reopening a recommendation surfaces a warning that previously triggered workflows will not be reversed, and requires explicit confirmation. |
| AC-9 | Bulk accept/reject on 50 recommendations of the same type completes workflow queuing within 30 seconds. |
| AC-10 | Every accept/reject decision appears in the audit log with all required fields populated and is retrievable via admin filter within 60 seconds of the event. |
| AC-11 | An admin can export the audit log as a CSV containing all fields for a specified date range. |
| AC-12 | A `viewer` role user cannot see Accept or Reject controls; a `decider` cannot access workflow binding configuration. |
| AC-13 | A webhook-based workflow receives the standard payload and responds; the system correctly marks it as `Succeeded` on a 2xx HTTP response and `Failed` on non-2xx or timeout (>30s). |

---

## Out of Scope

- **Recommendation generation logic** — how recommendations are created, ranked, or personalized is outside this PRD.
- **Workflow authoring UI** — building or editing workflow definitions within the product; workflows are authored externally and registered.
- **Conditional/branching workflow logic** — multi-step orchestration within a single workflow; the system triggers workflows, it does not orchestrate their internal steps.
- **Natural language or conversational decision interface** — decisions are made via explicit UI controls only in v1.
- **Mobile native apps** — web responsive UI only for v1.
- **SLA enforcement on external workflows** — the system tracks status but cannot enforce or guarantee execution time of external webhook targets.
- **Undo / rollback of triggered workflows** — the system does not attempt to reverse workflow side effects upon decision amendment.
- **Multi-level approval chains** — v1 supports a single decider per recommendation; multi-approver workflows are deferred to a future release.
- **A/B testing of recommendation presentation** — out of scope for this PRD.