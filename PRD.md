> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #1269
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Platform Defect – "failure_breaker" Stall Cohort

## Problem & Goal
**Problem:** 26 tickets in project 11 are stalled with identical root cause (`failure_breaker`). Consecutive failed runs triggered a safety breaker on each ticket, causing the autonomy system to cease re-dispatching them. The longest stall is 29 days. This is a single platform/configuration defect, not 26 independent ticket problems.

**Goal:** Correct the shared underlying defect so that the `failure_breaker` condition is resolved across all 26 affected tickets in one pass, removing the cohort from the stall census.

## Target Users / ICP Roles
- Platform engineers responsible for autonomy dispatch and breaker logic.
- Support/operations staff monitoring ticket stall dashboards.
- AI Manager (consumer of stall census) — expects cohort collapse upon fix.

## Scope
- Investigation and remediation of the configuration or logic defect causing the `failure_breaker` to trigger on consecutive failed runs across project 11.
- Verification against the sample tickets: 158, 140, 139, 165, 69.
- Post-fix re-check of the AI Manager stall census to confirm the 26-ticket cohort clears.
- Preventing recurrence through any necessary configuration or code change.

## Functional Requirements
1. **Root Cause Identification:** Analyze the breaker logic and project 11 configuration to determine why consecutive failures cause a permanent stall (no automatic re-dispatch or reset).
2. **Fix Implementation:** Apply platform-level change (code, config, or policy) that resolves the breaker condition for all stalled tickets in the cohort without manual per-ticket intervention.
3. **Cohort Validation:** Confirm the fix resolves the specific failure pattern seen in sample tickets 158, 140, 139, 165, 69.
4. **Census Re-check:** Re-read the manager stall census post-fix to verify the 26-ticket `failure_breaker` cohort has collapsed (tickets resumed or re-dispatched).
5. **Monitoring Update (optional but recommended):** Ensure the breaker mechanism allows recovery or alerting after a defined threshold rather than permanent stall.

## Acceptance Criteria
- **AC1:** Root cause of the shared `failure_breaker` stall is documented and addressed in platform configuration/logic.
- **AC2:** After the fix is deployed, all 26 tickets (including samples 158, 140, 139, 165, 69) are no longer stalled by `failure_breaker` — they either resume autonomously or are eligible for re-dispatch.
- **AC3:** A fresh stall census from the AI Manager shows zero tickets in the `failure_breaker` cohort for project 11.
- **AC4:** No new tickets join a `failure_breaker` stall cohort of this scale due to the same defect within the next 7 days.

## Out of Scope
- Manual remediation or closing of the 26 individual tickets (fix the platform, not the tickets).
- Changes to breaker logic for other projects unless impacted by the same root cause.
- Retrospective cleanup of ticket history or metrics.
- Enhancements unrelated to the safety breaker (e.g., general dispatch performance, other stall reasons).

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