> **PRD** — drafted by Ada (Sr. Product Mgr) · task #533
> _Each agent that updates this PRD signs its change below._
> Business Analyst — 2026-08-03: authored Requirements section (traceable reqs REQ-G1-01 through REQ-SO-02, traceability matrix)

# Product Requirements Document: Security Audit Sign-Off for GAP-G1 and GAP-G2 (Task #486)

## Problem & Goal
Security hardening deltas GAP-G1 and GAP‑G2 have been implemented (middleware and Docker/Kubernetes), but the corresponding audit evidence and validation steps are not yet consistently collected, reviewed, or signed off. Without a formal audit sign-off, compliance status remains unverifiable, and the risk of token exposure or configuration drift is not closed.

**Goal:** Complete the audit sign-off by verifying and documenting that GAP-G1 and GAP-G2 controls are fully operational in production, that all audit artifacts are tamper‑evident and correctly scrubbed, and that a designated manager confirms closure. This document defines the verification steps and acceptance criteria required to mark task #486 as done.

## Target Users / ICP Roles
- **Operations/Platform Engineers** – Execute verification steps, deploy policies, and gather evidence.
- **Security Auditor / Compliance Reviewer** – Reviews logs, schemas, and test results for correctness.
- **Manager (Approver)** – Performs final sign-off after all checks pass.

## Scope
- **GAP‑G1 verification:**  
  - Deploy AppArmor profile to production sandboxes.  
  - Confirm cgroup metrics and associated alerts are in place.  
  - Verify event logs contain no raw tokens (i.e., token scrubbing works end‑to‑end).  
- **GAP‑G2 verification:**  
  - Update the audit schema to replace the `Authorization` field with a SHA‑256 token hash.  
  - Run an audit log sanity check on recent production logs.  
  - Confirm that the automated test suite explicitly covers token scrubbing.  
- **Manager sign‑off:** Validate that all verifications are completed and documented; record the approval.

## Functional Requirements
### GAP‑G1
1. **AppArmor Deployment**  
   - The AppArmor profile defined in the hardening delta must be loaded and enforced on all production sandbox workloads.  
   - A verification command (e.g., `aa-status`) must show the profile in enforce mode.  
2. **Cgroup Metrics & Alerts**  
   - Prometheus (or equivalent) must export resource usage metrics for each sandbox cgroup.  
   - Alert rules must be configured to fire when resource limits are approached or breached.  
   - A dashboard or alert history must confirm that the metric pipeline is active and alerts are evaluated.  
3. **Event Log Token Scrubbing**  
   - All event logs (application, access, audit) must be sampled from the last 24 hours.  
   - A log‑scanning script must demonstrate that no raw `Authorization` header values, bearer tokens, or similar secrets appear in plaintext.  

### GAP‑G2
1. **Audit Schema Update**  
   - The audit log’s data model must be changed so that the previous `Authorization` string column is removed and a new `token_hash` (SHA‑256, hex‑encoded) column is added.  
   - A migration script must backfill existing logs: `token_hash = SHA256(old_authorization)` and then drop the plaintext column.  
   - The change must be applied to the production audit database.  
2. **Sanity Check**  
   - After schema migration, query the audit log for recent entries and confirm:  
     - No column named `Authorization` exists.  
     - The `token_hash` column contains valid 64‑character hex strings for all non‑null entries.  
     - Row counts before and after migration match.  
3. **Test Suite Coverage**  
   - The automated test suite must include a test case that creates audit records with a token, forces log flushing, and then asserts that the emitted log entry contains `token_hash` and no plaintext token.  
   - The test must pass in the CI pipeline and be traceable to the GAP‑G2 requirement.  

### Manager Sign‑Off
- A signed‑off checklist (or equivalent approval record) must be added to the task tracking system, confirming that all GAP‑1 and GAP‑2 verifications were independently reviewed and passed.

## Acceptance Criteria
- [ ] AppArmor profile enforced on all production sandboxes (verified by a timestamped output).  
- [ ] cgroup metrics dashboards show live data; alert rules exist and at least one test firing event is recorded.  
- [ ] Log‑scanning script output confirms zero raw tokens in a representative log sample.  
- [ ] Audit schema migration completed – production audit table has `token_hash`, no `Authorization`.  
- [ ] Sanity check script exits 0: hash validity, no plaintext column, count preservation.  
- [ ] CI test for token scrubbing passes and is linked to the requirement.  
- [ ] Manager approval recorded in the ticket with a date and identity (e.g., “Signed off: jane.doe@company.com on 2025‑MM‑DD”).  

## Out of Scope
- Implementation of the original GAP‑G1 / GAP‑G2 hardening deltas (already completed).  
- Changes to AppArmor profile or cgroup limits outside the scope of verification.  
- Broader audit log retention policy or encryption‑at‑rest (only the immediate schema change and verification).  
- Integration with external compliance systems beyond internal manager sign‑off.  
- Rollback plan for GAP‑G1 or GAP‑G2 (handled by separate change management).

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