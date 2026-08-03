> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #1145
> _Each agent that updates this PRD signs its change below._

# PRD: Remediate Platform Defect Causing 14 Stalled Tickets (never_started)

## Problem & Goal
- **Problem:** 14 tickets in project 11 are permanently stuck in the `never_started` status. The AI manager identified a cohort of this size as a single underlying platform defect rather than individual ticket failures. The root cause is a critical component of the execution pipeline (scheduler or a required dependency) that is unavailable or misconfigured, preventing any new task initiation.
- **Goal:** Restore normal task execution so that new tasks can be initiated and all stalled tickets progress out of `never_started`. Ensure the issue does not recur immediately; provide operational visibility to detect similar stalls early.

## Target users / ICP roles
- **Primary:** SRE and Platform Engineering teams responsible for the availability and health of the execution pipeline.
- **Secondary:** Support engineers who triage stalled tickets and the AI Manager that monitors stall cohorts.

## Scope
- Investigate and remediate the scheduler service and its dependencies (configuration, connectivity, health) to restore task initiation.
- Examine and fix the worker pool provisioning mechanism so that available workers can accept new tasks.
- Verify that the stalled tickets can start executing without manual per‑ticket intervention.
- (Optional) Add a basic alert or metric for a sudden accumulation of `never_started` tickets beyond a defined threshold to accelerate future detection.
- Document the root cause and the steps taken to resolve the incident.

## Functional requirements
1. **FR1 – Scheduler diagnostics:** Perform a health check on the scheduler service, its configuration (environment variables, feature flags), and all dependencies (database, message broker, service discovery). Identify the exact failure that caused task initiation to halt.
2. **FR2 – Worker pool inspection:** Verify that worker instances are registered, healthy, and able to accept work. Confirm that resource limits (e.g., max concurrent tasks, pod counts) are not exhausted or misconfigured.
3. **FR3 – Apply fix:** Execute corrective actions such as restarting the scheduler, correcting a misconfigured parameter, clearing a persistent error state, or scaling/repairing the worker pool.
4. **FR4 – Smoke test task initiation:** Create one or more test tasks in the same project to confirm that a new task transitions from `never_started` to an active state (e.g., `in_progress`) without delay.
5. **FR5 – Batch resolve stalled tickets:** Ensure that the 14 identified stalled tickets are picked up by the scheduler and start executing. If a manual trigger is required (e.g., a one-time bulk restart mechanism), execute it safely.
6. **FR6 – Monitoring enhancement (optional but recommended):** Implement or configure a metric/alert that fires when the count of `never_started` tickets for a project exceeds a threshold (e.g., 5) for more than a configured period, to catch future scheduler stalls proactively.

## Acceptance criteria
- After the fix is applied, the AI Manager stall census for project 11 shows **0 tickets** in the `never_started` cohort (all 14 previously stalled tickets have transitioned to at least `in_progress` or a terminal state).
- No new tickets become added to the `never_started` cohort following the remediation.
- A synthetic task created in the affected project starts successfully within [time window, e.g., 2 minutes] of creation.
- Scheduler health endpoint returns `healthy` and worker pool reports available capacity.
- Operations documentation (runbook or post‑mortem) is updated with the root cause, actions taken, and any preventive measures (including the monitoring enhancement if implemented).

## Out of scope
- Modifying the ticket workflow, status model, or project configuration beyond what is needed to unblock execution.
- Individual ticket triage or manual intervention for each stalled ticket as a separate operation; the fix must be a platform-level remediation.
- Performance or scalability tuning of the scheduler or worker pool that goes beyond restoring basic functional health.
- Long-term architectural redesign of the execution pipeline (e.g., replacing the scheduler). The immediate goal is incident resolution.

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