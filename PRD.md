> **PRD** — drafted by Ada (Sr. Product Mgr) · task #767
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Automated Resolution at Manifest Read and Dispatch

## Problem & Goal
Operators currently waste time manually resolving common discrepancies (missing data, scheduling conflicts, dependency errors) when a manifest is ingested or a dispatch is triggered. This manual step introduces latency, human error, and process variation.

**Goal:** Automatically resolve all known, non‑critical issues at the moment a manifest is read or a dispatch is initiated, so processing continues instantly with zero human intervention. The system will apply pre‑configured rules to fix the problem, log the action, and proceed.

## Target Users / ICP Roles
- **Operations Managers** – oversee manifest and dispatch workflows, require zero‑touch execution.
- **Dispatch Coordinators** – initiate and monitor dispatches; benefit from elimination of repetitive fix steps.
- **System Administrators / DevOps** – configure resolution rules and monitor automated resolutions.
- **Compliance Auditors** – rely on the complete audit trail of automatic fixes.

## Scope
- Capture events: `manifest_read` (file parsed, record ingested) and `dispatch_start` (order, job, or shipment dispatched).
- Identify standard resolvable exceptions: missing optional fields, format mismatches, soft capacity overrides, minor scheduling overlaps, stale dependency versions, and retriable resource unavailability.
- Apply a deterministic, configurable rules engine to correct the issue **without pausing or queuing** the process.
- Log every resolution with before/after state, rule applied, and timestamp.
- Expose a monitoring dashboard (read‑only) showing resolution counts and types.
- Provide an administrative API to update/reset rules, disable specific auto‑resolutions per environment.

## Functional Requirements
1. **Event Interception**  
   - Intercept `manifest_read` and `dispatch_start` events from the core pipeline.  
   - No extra user action required; the interception is transparent to the caller.

2. **Issue Detection**  
   - Validate manifest/dipatch payload against a schema and a set of business rules.  
   - Detect categories: `missing_defaultable_field`, `version_mismatch`, `slot_conflict`, `soft_limit_exceeded`, `dependency_lag`.  
   - Only automatic‑resolution candidates are flagged; non‑resolvable issues (hard failures) are still raised as blocking errors.

3. **Resolution Engine**  
   - Apply the highest priority rule that matches the issue context.  
   - Example rules: populate missing field with system default; advance dependency version to latest compatible; shift dispatch slot by configured buffer; replace stale cache entry.  
   - All rules are defined in a declarative configuration (YAML/JSON) and can be hot‑reloaded.

4. **Audit Trail**  
   - For every resolution, record: event ID, issue type, original value, resolved value, rule ID, timestamp, user/system context.  
   - Write to an immutable log (append‑only) that is searchable and exportable.

5. **Monitoring**  
   - Expose aggregated metrics (resolutions per minute, by type, by rule) via a standard endpoint (e.g., Prometheus).  
   - Dashboard panel showing recent resolutions and any anomalies (e.g., rule that triggered 10x more than usual).

6. **Administration**  
   - REST API to add/update/delete resolution rules.  
   - Ability to set a rule to “dry‑run” mode (log but not apply).  
   - Ability to disable auto‑resolution entirely for a given event type in a specific environment (emergency override).

## Acceptance Criteria
- When a manifest is read containing a field that matches a configured default rule, the value is set to the default and processing continues within 500ms, with no user prompt or ticket created.
- When a dispatch is initiated and a soft scheduling conflict is detected, the system automatically adjusts the time slot by the configured buffer and proceeds; the dispatch record reflects the adjusted time.
- Audit log entries are created synchronously for each resolution, containing all required data points.
- The `auto_resolution_total` metric increments by 1 for each resolution and can be queried immediately.
- If a rule matches but is set to dry‑run, the issue is logged but not fixed; processing **fails** with the original error (no silent ignore).
- When auto‑resolution is disabled for `manifest_read`, the same missing field causes a blocking error as before the feature.

## Out of Scope
- Resolution of issues that require human judgment, such as legal compliance checks, customer‑specific overrides, or pricing disputes.
- Problems detected **outside** the `manifest_read` or `dispatch_start` events (e.g., mid‑process failures, post‑dispatch incidents).
- Manual override UI during the automated resolution step (post‑mortem override is handled by existing ticket system).
- Non‑standard manifest formats – only manifests conforming to the v2 schema are supported for auto‑resolution.
- Autonomous learning of new resolution rules; rules must be explicitly configured.

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