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

_Owned by the business-analyst._

### REQ-G1-01: AppArmor Profile Enforcement

**Priority:** P0 (blocking)  
**Traceability:** GAP‑G1 Functional Requirement 1 · AC‑1  

The system SHALL enforce the AppArmor profile defined in the GAP‑G1 hardening delta on every production sandbox workload. A verification command (`aa-status`) executed on each production host MUST return the profile name in enforce mode, and the output MUST be captured as timestamped evidence.

**Validation:**  
- Run `aa-status | grep -A3 <profile-name>` on each production sandbox host.  
- Store the full output as a timestamped artifact linked to this task.  
- The artifact SHALL show `enforce` (not complain/audit) for the target profile.

---

### REQ-G1-02: Cgroup Metrics Export

**Priority:** P1  
**Traceability:** GAP‑G1 Functional Requirement 2 · AC‑2  

The metrics pipeline SHALL export per‑sandbox cgroup resource-usage metrics (CPU, memory, I/O) to the observability stack (Prometheus or equivalent) with a scrape interval ≤ 60 seconds. An alert rule SHALL be configured to fire at `WARNING` severity when any sandbox cgroup exceeds 80% of its resource limit, and at `CRITICAL` when it exceeds 95%.

**Validation:**  
- Confirm metric series exist in the Prometheus TSDB for each sandbox cgroup (query: `container_cpu_usage_seconds_total{container=~"sandbox-.*"}` or equivalent).  
- Confirm alert rules are loaded and evaluating (`promtool check rules`, or UI screenshot).  
- Trigger a test alert (e.g., temporarily lower the limit) and capture the firing notification as evidence.

---

### REQ-G1-03: Log Token Scrubbing — Zero Plaintext Secrets

**Priority:** P0 (blocking)  
**Traceability:** GAP‑G1 Functional Requirement 3 · AC‑3  

A log‑scanning script SHALL sample the last 24 hours of application, access, and audit logs and SHALL exit 0 ONLY when zero raw `Authorization` header values, bearer tokens, or `token=` query‑string parameters appear in plaintext. The scan scope SHALL include all log streams emitted by the API, agent‑runtime, and sandbox infrastructure.

**Token patterns to detect:**  
- `Authorization: Bearer <jwt>` (any JSON Web Token in header value)  
- `Authorization: Basic <base64>`  
- `token=<jwt>` (query‑string token)  
- `x-api-key:` headers  
- Any 64‑char hex string matching a known SHA‑256 hash pattern (false‑positive mitigation: exclude known non‑secret hashes like git commit SHAs and content‑hash ETags)

**Validation:**  
- Execute the log‑scanning script against production log archives.  
- Script exit code 0 = pass; exit code 1 = raw tokens found (the script SHALL emit the file path and line number of any match).  
- Store the scan output as evidence linked to this task.

---

### REQ-G2-01: Audit Schema Migration — Replace Authorization with token_hash

**Priority:** P0 (blocking)  
**Traceability:** GAP‑G2 Functional Requirement 1 · AC‑4  

The audit database schema SHALL be migrated so that:  

1. A new column `token_hash CHAR(64) NOT NULL DEFAULT ''` is added to the audit log table.  
2. Every existing row with a non‑null `Authorization` value is backfilled: `token_hash = SHA256(authorization)`.  
3. The `Authorization` column is dropped.  
4. Row count before and after migration MUST be identical.  

The migration SHALL be applied to the production audit database via a single idempotent migration script that is safe to re‑run (detects already‑applied schema and exits 0).

**Validation:**  
- After migration, `DESCRIBE audit_log` (or equivalent) SHALL show `token_hash` and SHALL NOT show `Authorization`.  
- `SELECT COUNT(*) FROM audit_log` before and after migration SHALL return the same value.  
- `SELECT COUNT(*) FROM audit_log WHERE token_hash = '' OR token_hash IS NULL OR LENGTH(token_hash) != 64` SHALL return 0 for non‑null original tokens (empty/revoked tokens where `Authorization` was null or empty may remain `''`).

---

### REQ-G2-02: Sanity Check Script

**Priority:** P1  
**Traceability:** GAP‑G2 Functional Requirement 2 · AC‑5  

A standalone sanity‑check script SHALL validate the migrated audit log table and SHALL exit 0 only when all of the following hold:  

1. No column named `Authorization` (case‑insensitive) exists in the table.  
2. Every non‑empty `token_hash` value matches the regex `^[a-f0-9]{64}> **PRD** — drafted by Ada (Sr. Product Mgr) · task #533
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

.  
3. Row count matches the pre‑migration snapshot (or, if no snapshot is available, is non‑zero and consistent with the most recent audit‑log flush count).  

The script SHALL output a structured JSON report (`{ passed: true|false, checks: [{ name, passed, detail }], rowCount: N }`) to stdout. When `passed` is `false`, the failing check(s) SHALL include a diagnostic detail string.

**Validation:**  
- Execute the sanity‑check script against the production audit database.  
- Confirm exit code 0 and `"passed": true` in the JSON report.  
- Commit the report as evidence.

---

### REQ-G2-03: CI Test Coverage for Token Scrubbing

**Priority:** P1  
**Traceability:** GAP‑G2 Functional Requirement 3 · AC‑6  

The automated test suite SHALL include at least one test case that:  

1. Creates one or more audit records using the audit service, passing a known bearer token.  
2. Forces log flush (or awaits flush interval).  
3. Asserts that the emitted/logged record contains `token_hash` (a 64‑char hex string).  
4. Asserts that the emitted/logged record does NOT contain the original bearer token in plaintext.  

The test case SHALL be annotated with a comment or tag linking it to REQ‑G2‑03 / GAP‑G2 for traceability. It SHALL pass in the CI pipeline on every commit to `main`.

**Validation:**  
- Locate the test case in the test suite (search for `REQ-G2-03` or `GAP-G2` annotation).  
- Confirm the test passes in the most recent CI run for the `main` branch.  
- Link the CI run URL as evidence.

---

### REQ-SO-01: Manager Sign‑Off Checklist

**Priority:** P0 (blocking completion)  
**Traceability:** Manager Sign‑Off · AC‑7  

Before task #486 is marked Done, a designated manager SHALL record a sign‑off in the task tracking system containing:  

- Full name (or verified identity) of the approver.  
- Date of approval (ISO 8601).  
- Explicit confirmation that each of the seven acceptance criteria (AC‑1 through AC‑7) has been independently reviewed and passed.  

The sign‑off SHALL be non‑transferable (the approver's identity is verified by the system). A placeholder or automated "bot" sign‑off does NOT satisfy this requirement.

**Validation:**  
- The task tracking record for #486 SHALL contain a manager approval entry meeting all fields above.  
- The approval entry SHALL be immutable once recorded.

---

### REQ-SO-02: Evidence Retention

**Priority:** P2  
**Traceability:** Cross‑cutting (all GAP‑G1/GAP‑G2 verification)  

Every verification artifact (AppArmor output, cgroup metrics screenshot, log‑scan report, migration snapshot, sanity‑check report, CI run URL) SHALL be retained as an attachment or linked reference on task #486 for a minimum of 90 days post‑sign‑off. Artifacts SHALL be stored in a tamper‑evident manner (versioned file, immutable attachment, or content‑addressed store).

**Validation:**  
- Confirm that task #486 has attachments or references for each artifact class listed above.  
- Spot‑check one artifact to verify it is retrievable and unaltered.

---

### Traceability Matrix

| Requirement | Covers | GAP Source | Acceptance Criteria | Priority |
|---|---|---|---|---|
| REQ-G1-01 | AppArmor enforcement verification | GAP‑G1 FR‑1 | AC‑1 | P0 |
| REQ-G1-02 | Cgroup metrics + alerts verification | GAP‑G1 FR‑2 | AC‑2 | P1 |
| REQ-G1-03 | Log token‑scrubbing verification | GAP‑G1 FR‑3 | AC‑3 | P0 |
| REQ-G2-01 | Audit schema migration | GAP‑G2 FR‑1 | AC‑4 | P0 |
| REQ-G2-02 | Sanity‑check script | GAP‑G2 FR‑2 | AC‑5 | P1 |
| REQ-G2-03 | CI test coverage for token scrubbing | GAP‑G2 FR‑3 | AC‑6 | P1 |
| REQ-SO-01 | Manager sign‑off | Manager Sign‑Off | AC‑7 | P0 |
| REQ-SO-02 | Evidence retention | Cross‑cutting | All | P2 |

### Requirement Dependencies

```
REQ-G1-01 ──┐
REQ-G1-02 ──┤
REQ-G1-03 ──┼──► REQ-SO-01 (all G1+G2 verifications must pass before sign-off)
REQ-G2-01 ──┤
REQ-G2-02 ──┤
REQ-G2-03 ──┘
                 │
                 └──► REQ-SO-02 (evidence collected during verification is retained)
```

REQ‑G2‑01 (schema migration) MUST complete before REQ‑G2‑02 (sanity check) can pass. All six G1/G2 verification requirements MUST be satisfied before REQ‑SO‑01 (manager sign‑off) can be recorded. Evidence collected during any verification step SHALL satisfy REQ‑SO‑02.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._