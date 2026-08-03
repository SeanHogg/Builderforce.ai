> **PRD** — drafted by Ada (Sr. Product Mgr) · task #556
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: PagerDuty Webhook Lifecycle Processing

## Problem & Goal
**Problem**: The existing PagerDuty v3 webhook integration verifies `X-PagerDuty-Signature` and routes incident-category events to `prod_incidents`, but does not parse or act upon individual lifecycle events (`triggered`, `acknowledged`, `resolved`, `escalated`). As a result, incident statuses are not updated in real time, leaving responders with stale information.

**Goal**: Wire handlers that parse incoming lifecycle webhooks and instantly update the corresponding internal incident record, ensuring that the incident’s status accurately reflects its current state in PagerDuty.

## Target Users / ICP Roles
- **Primary users**: SRE, on-call engineers, incident commanders  
- **Ideal customer profile (ICP) roles**: DevOps Engineer, SRE, Platform Engineer  
*These roles rely on real-time incident status visibility to coordinate response and recovery.*

## Scope
- **In scope**:
  - Handling PagerDuty v3 webhooks for incident lifecycle events: `incident.triggered`, `incident.acknowledged`, `incident.resolved`, `incident.escalated`.
  - Updating the status field of the corresponding incident record in the internal system upon receipt of these events.
  - Reusing the existing signature verification and routing logic for `prod_incidents`.
  - Ensuring idempotent processing for duplicate or out-of-order deliveries.
- **Out of scope**:
  - Processing non-lifecycle incident webhooks (e.g., `incident.annotated`, `incident.priority_updated`).
  - Handling webhook v2 or other PagerDuty event types (e.g., service, alert).
  - Creating new incidents from webhooks (only status updates on existing incidents).
  - Modifications to the UI or notification systems.
  - Integration with other monitoring/alerting tools.

## Functional Requirements
1. **Event Parsing**  
   The webhook handler must parse the `event_type` field from the PagerDuty v3 payload to identify lifecycle events:  
   - `incident.triggered`
   - `incident.acknowledged`
   - `incident.resolved`
   - `incident.escalated`

2. **Incident Identification**  
   Extract the PagerDuty incident ID (`id` from the payload’s `incident` object) and map it to the internal incident record. If no matching incident exists, log a warning and discard the event.

3. **Status Mapping**  
   Map the lifecycle event to the corresponding internal status value (e.g., `Open` for triggered, `Acknowledged`, `Resolved`, `Escalated`). The mapping must be documented and deterministic.

4. **Record Update**  
   Update the internal incident record’s `status` (and optionally `updated_at` timestamp) atomically. The update must reflect the latest state based on PagerDuty’s timestamp (`occurred_at` or `log_entries.log_entry.notification_time`) to avoid out-of-order updates.

5. **Signature Verification**  
   Continue to validate the `X-PagerDuty-Signature` header on every request before processing, as per existing implementation.

6. **Idempotency**  
   Handle duplicate deliveries gracefully: if the incident already has the same status, do not re-apply the update, and log the repetition.

7. **Error Handling**  
   - Log malformed payloads and reject with `400 Bad Request`.
   - Log failures to identify incident and respond with `200 OK` to acknowledge receipt, to prevent PagerDuty retries.
   - Log database update failures; respond with `500 Internal Server Error` after maximum internal retries.

8. **Backward Compatibility**  
   The processing logic must not break the existing routing to `prod_incidents`; all incident-category webhooks that are not lifecycle events should be silently accepted and ignored (or logged).

## Acceptance Criteria
- **AC1**: When a valid `incident.triggered` webhook is received with a known incident ID, the internal incident’s status is updated to `triggered` within 5 seconds.
- **AC2**: When `incident.acknowledged`, `incident.resolved`, or `incident.escalated` webhooks are received, the status is updated accordingly.
- **AC3**: Signature verification passes before any processing; invalid signatures result in `401 Unauthorized`.
- **AC4**: Duplicate events for the same status do not cause additional updates or side effects.
- **AC5**: An event for an unknown incident ID is logged and returns `200 OK` without error.
- **AC6**: A webhook with a non-lifecycle incident event_type (e.g., `incident.custom`) does not trigger an update and returns `200 OK`.
- **AC7**: All acceptance tests (FR-2.5, AC-PD-3) pass, verifying end-to-end status sync.

## Out of Scope
- Handling PagerDuty v2 webhooks.
- Non-incident webhook events (services, alerts, heartbeat).
- Creating or deleting incidents via webhooks.
- Modifying the PagerDuty integration UI or configuration.
- Cross-system incident correlation or enrichment.

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