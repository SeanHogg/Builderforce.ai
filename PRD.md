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

> Authored by the business-analyst · task #767

---

### REQ-1: User Stories

| ID | Role | Story | Priority |
|----|------|-------|----------|
| US-1 | Operations Manager | **As an** Operations Manager, **I want** manifest ingestion to auto-correct missing optional fields, format mismatches, and stale dependency versions **so that** manifests move through the pipeline without me opening a ticket for every minor discrepancy. | P0 — Must Have |
| US-2 | Dispatch Coordinator | **As a** Dispatch Coordinator, **I want** dispatch initiation to auto-resolve soft scheduling overlaps and soft capacity overrides by shifting slots or reassigning capacity **so that** dispatches proceed immediately instead of queueing for manual triage. | P0 — Must Have |
| US-3 | System Administrator | **As a** System Administrator, **I want** to define resolution rules in a declarative configuration (JSON/YAML), hot-reload them without restarting the service, and toggle individual rules between active and dry-run mode **so that** I can tune auto-resolution behaviour per environment without deploying code. | P1 — Must Have |
| US-4 | DevOps Engineer | **As a** DevOps Engineer, **I want** resolution metrics (counts by type, by rule, per minute) exposed via a standard Prometheus endpoint and a read-only dashboard panel **so that** I can monitor resolution rates and detect anomalous rule activity (e.g. a rule firing 10× its baseline). | P1 — Must Have |
| US-5 | Compliance Auditor | **As a** Compliance Auditor, **I want** every automated resolution to produce an immutable audit-log entry containing event ID, issue type, original value, resolved value, rule ID, timestamp, and context **so that** I have a complete, searchable trail of every automatic change made during manifest/dipatch processing. | P0 — Must Have |
| US-6 | Operations Manager | **As an** Operations Manager, **I want** a per-event-type emergency override that disables all auto-resolution for `manifest_read` or `dispatch_start` independently **so that** when a misbehaving rule is discovered, I can halt auto-resolution immediately without taking the whole pipeline offline. | P1 — Must Have |

---

### REQ-2: Event Interception Points

The system MUST intercept exactly two lifecycle events at the exact call-site before business logic proceeds:

#### REQ-2.1: `manifest_read`

- **Trigger:** Any call to `loadPluginManifest()` in `agent-runtime/src/plugins/manifest.ts`, or any code path that reads and parses a `builderforce.plugin.json` manifest from disk. Also applies to manifest-registry reads (`manifest-registry.ts`) where a cached or freshly loaded manifest is returned.
- **Interception point:** Immediately after the raw JSON is parsed and before the parsed `PluginManifest` object is returned to the caller. If the manifest fails to parse, auto-resolution is NOT attempted (parsing failures are hard errors, not auto-resolvable).
- **Payload context available at interception:**
  - `manifestPath` (string) — filesystem path to the manifest file.
  - `parsedManifest` (object) — the partially parsed manifest, before validation coercion.
  - `source` (enum: `disk` | `registry-cache` | `remote`).
  - `callerContext` — identifier for the subsystem that requested the read (e.g. `loader`, `config-validation`, `skills-discovery`).

#### REQ-2.2: `dispatch_start`

- **Trigger:** Any call that initiates an agent dispatch — specifically when the runtime's dispatch/scheduling layer starts a new run for an agent (the code path that transitions an agent from `pending` → `running`).
- **Interception point:** After the dispatch payload is assembled (agent ref, task context, tool profile, memory slots) and validated against basic invariants, but before the agent executor process is forked/started.
- **Payload context available at interception:**
  - `dispatchId` (string) — unique identifier for this dispatch instance.
  - `agentRef` (string) — the agent being dispatched.
  - `taskContext` (object) — the task, project, and configuration driving this dispatch.
  - `scheduledAt` (ISO-8601 string) — the scheduled dispatch time.
  - `resourceProfile` (object) — tool grants, memory slots, capacity allocation.
  - `dependencies` (string[]) — resolved dependency versions in use.

---

### REQ-3: Issue Detection Taxonomy

The system MUST detect the following issue categories. Each detection produces a typed finding with a severity of `auto_resolvable` or `hard_error`.

| Category ID | Name | Detectable At | Detection Rule | Default Resolution |
|---|---|---|---|---|
| `missing_defaultable_field` | Missing Defaultable Field | `manifest_read`, `dispatch_start` | A field declared in the schema with a `default` value is absent or `null` in the payload. | Populate with the schema-declared default. |
| `version_mismatch` | Version Mismatch | `manifest_read`, `dispatch_start` | A dependency version string does not satisfy the declared semver constraint (e.g. `^2.0.0` but payload has `1.9.0`). | Advance to the latest compatible version within the constraint range. If no compatible version exists, escalate to `hard_error`. |
| `slot_conflict` | Dispatch Slot Conflict | `dispatch_start` | Two dispatches are scheduled for overlapping time windows beyond the configured concurrency limit for the resource class. | Shift the later dispatch's start time forward by the configured `slot_buffer_seconds`. |
| `soft_limit_exceeded` | Soft Limit Exceeded | `dispatch_start` | A resource allocation exceeds the soft cap but is below the hard cap (e.g. memory: soft 512 MB, hard 1 GB, actual 768 MB). | Accept the allocation and record the overage. |
| `dependency_lag` | Stale Dependency | `manifest_read` | A declared dependency version is more than N patch versions behind the latest published version (configurable threshold). | Update to the latest compatible version within the same major/minor band. |
| `format_coercion` | Format Coercion | `manifest_read` | A field value uses a non-canonical format that can be losslessly normalised (e.g. `"true"` → `true`, ISO-8601 variant → canonical ISO-8601). | Coerce to canonical format. |
| `retriable_unavailable` | Retriable Resource Unavailable | `dispatch_start` | A required resource (e.g. sandbox image, LLM endpoint) returned a transient failure on initial probe. | Retry with exponential backoff up to configured `max_retries` before dispatching. |

---

### REQ-4: Resolution Engine Behaviour

#### REQ-4.1: Rule Definition Format

All resolution rules MUST be defined in a declaration JSON file at a well-known path. The format:

```jsonc
{
  "version": "1",
  "rules": [
    {
      "id": "populate-defaults-manifest",
      "event": "manifest_read",
      "category": "missing_defaultable_field",
      "priority": 100,
      "mode": "active",              // "active" | "dry_run"
      "match": {
        "fieldPattern": "configSchema.properties.*.default"  // glob over schema paths
      },
      "action": {
        "type": "set_default",
        "source": "schema_default"
      }
    },
    {
      "id": "shift-dispatch-slot",
      "event": "dispatch_start",
      "category": "slot_conflict",
      "priority": 90,
      "mode": "active",
      "match": {
        "overlapWindowMs": { "gt": 0 }
      },
      "action": {
        "type": "shift_slot",
        "bufferSeconds": 60,
        "maxShiftSeconds": 900
      }
    },
    {
      "id": "advance-dependency-version",
      "event": "manifest_read",
      "category": "version_mismatch",
      "priority": 80,
      "mode": "active",
      "match": {
        "versionConstraint": "*"
      },
      "action": {
        "type": "advance_version",
        "strategy": "latest_compatible"
      }
    },
    {
      "id": "accept-soft-limit-overage",
      "event": "dispatch_start",
      "category": "soft_limit_exceeded",
      "priority": 70,
      "mode": "active",
      "match": {},
      "action": {
        "type": "accept_overage",
        "maxOveragePercent": 200
      }
    },
    {
      "id": "refresh-stale-dependency",
      "event": "manifest_read",
      "category": "dependency_lag",
      "priority": 60,
      "mode": "active",
      "match": {
        "patchVersionsBehind": { "gte": 3 }
      },
      "action": {
        "type": "advance_version",
        "strategy": "latest_patch"
      }
    },
    {
      "id": "coerce-format",
      "event": "manifest_read",
      "category": "format_coercion",
      "priority": 50,
      "mode": "active",
      "match": {
        "coercionType": ["boolean_string", "iso8601_variant", "int_string"]
      },
      "action": {
        "type": "coerce"
      }
    },
    {
      "id": "retry-transient-resource",
      "event": "dispatch_start",
      "category": "retriable_unavailable",
      "priority": 40,
      "mode": "active",
      "match": {},
      "action": {
        "type": "retry",
        "maxRetries": 3,
        "backoffMs": [1000, 5000, 15000]
      }
    }
  ],
  "overrides": {
    "manifest_read": "enabled",    // "enabled" | "disabled" | "dry_run_all"
    "dispatch_start": "enabled"
  }
}
```

#### REQ-4.2: Priority Resolution

When multiple rules match a single issue:

1. Group all matches by `category`.
2. Within each category, select the rule with the highest `priority` (largest integer).
3. If two rules in the same category have equal priority, select the one with the lexicographically smaller `id` (deterministic tie-break).
4. Apply exactly ONE resolution per issue.

#### REQ-4.3: Dry-Run Mode

When a rule's `mode` is `"dry_run"`:

- The issue MUST be logged (audit entry with `applied: false`).
- The original error MUST be raised as a blocking error — processing stops.
- The metric `auto_resolution_dry_run_total` MUST increment (separate from `auto_resolution_total`).

#### REQ-4.4: Environment Override

When `overrides.{event}` is `"disabled"`:

- Resolution is skipped entirely for that event type.
- No audit entry is created.
- All issues surface as their original blocking errors.
- The metric `auto_resolution_disabled_total{event="..."}` MUST increment for every event intercepted while disabled.

When `overrides.{event}` is `"dry_run_all"`:

- All rules for that event behave as if `mode: "dry_run"` regardless of their individual `mode` setting.

#### REQ-4.5: Hot-Reload

The system MUST watch the rules configuration file for changes (via `fs.watch` or equivalent). When the file is modified:

1. Reload and re-validate the entire ruleset atomically.
2. If the new ruleset is valid, swap it in under a mutex. If invalid, keep the current ruleset and log an error — never revert to an empty/partial ruleset.
3. Emit a `rules_reloaded` diagnostic event with `{ ruleCount, invalid: false }` or `{ invalid: true, errors: [...] }`.

---

### REQ-5: Audit Trail Data Contract

Every resolution MUST produce one audit entry synchronously. The entry schema:

```jsonc
{
  "auditId": "uuid",                    // unique identifier for this resolution event
  "eventId": "string",                  // the intercepted event's ID (manifestPath or dispatchId)
  "eventType": "manifest_read | dispatch_start",
  "issueCategory": "missing_defaultable_field | version_mismatch | slot_conflict | soft_limit_exceeded | dependency_lag | format_coercion | retriable_unavailable",
  "ruleId": "string",                   // the rule.id that matched
  "priority": "number",
  "mode": "active | dry_run",
  "applied": "boolean",                 // true = resolution was applied; false = dry-run (logged only)
  "before": {
    "path": "string",                   // JSONPath to the field/attribute
    "value": "any"                      // original value (null if missing)
  },
  "after": {
    "value": "any"                      // resolved value (null if dry-run)
  },
  "timestamp": "ISO-8601",              // resolution time, millisecond precision
  "durationMs": "number",               // wall-clock time spent resolving, for latency SLA
  "context": {
    "source": "string",                 // disk | registry-cache | remote (for manifest_read) or the dispatch initiator (for dispatch_start)
    "caller": "string",                 // subsystem identifier
    "environment": "string"             // from NODE_ENV / env config
  }
}
```

Storage requirements:

- Append-only log in a directory: `{dataDir}/auto-resolution/{YYYY-MM-DD}.jsonl`
- One JSON line per entry — no in-place mutation, no deletion.
- The file for the current UTC day is opened in append mode; rotated at midnight.
- Searchable via a provided CLI command: `builderforce resolution-audit [--since DATE] [--event type] [--rule id] [--category cat]`
- Exportable: `builderforce resolution-audit --format csv --output file.csv`

---

### REQ-6: Monitoring & Metrics

#### REQ-6.1: Prometheus Metrics

The runtime MUST expose the following counters via a `/metrics` endpoint (Prometheus text format):

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `auto_resolution_total` | Counter | `event`, `category`, `rule_id`, `result` | Incremented by 1 per resolution. `result` = `applied` or `dry_run` or `error`. |
| `auto_resolution_duration_ms` | Histogram | `event`, `category` | Resolution wall-clock time in milliseconds. Buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000]. |
| `auto_resolution_issues_detected_total` | Counter | `event`, `category`, `severity` | Issues found, whether or not resolved. `severity` = `auto_resolvable` or `hard_error`. |
| `auto_resolution_disabled_total` | Counter | `event` | Events intercepted while the override for that event was `disabled`. |
| `auto_resolution_rule_reload_total` | Counter | `result` | Rule-file reloads. `result` = `success` or `invalid`. |
| `auto_resolution_sla_violation_total` | Counter | `event` | Resolutions exceeding the 500ms SLA. |

#### REQ-6.2: Dashboard

A read-only dashboard page (served at `{baseUrl}/auto-resolution`) MUST display:

- **Summary bar:** Total resolutions today, by event type, % dry-run, % SLA-compliant.
- **Resolution rate chart:** Line chart of `auto_resolution_total` per minute over the last 60 minutes.
- **Top rules table:** Rules ordered by resolution count (descending), with a sparkline of hourly counts for the last 24h.
- **Anomaly alert:** Any rule whose hourly rate exceeds 5× its trailing 7-day average is highlighted in red with the factor.
- **Recent resolution log:** Last 50 audit entries, filterable by event type and category.

---

### REQ-7: Administration API

| Method | Path | Request Body | Response | Description |
|---|---|---|---|---|
| `GET` | `/api/auto-resolution/rules` | — | `{ version, rules, overrides }` | Retrieve the current ruleset. |
| `PUT` | `/api/auto-resolution/rules` | Full rules JSON (same schema as REQ-4.1) | `{ accepted: true, ruleCount }` | Replace the entire ruleset. Validated before acceptance. |
| `PATCH` | `/api/auto-resolution/rules/{ruleId}` | Partial rule object (fields to update) | `{ updated: true }` | Update a single rule's `mode`, `priority`, `action` fields. |
| `DELETE` | `/api/auto-resolution/rules/{ruleId}` | — | `{ removed: true }` | Remove a single rule. |
| `PUT` | `/api/auto-resolution/overrides/{event}` | `{ mode: "enabled" | "disabled" | "dry_run_all" }` | `{ updated: true }` | Set the environment override for one event type. |
| `GET` | `/api/auto-resolution/audit` | Query params: `since`, `event`, `category`, `ruleId`, `limit` (default 100), `cursor` | `{ entries: [...], nextCursor }` | Paginated audit-log search. |

All endpoints require authentication (existing auth middleware). The `PUT` and `DELETE` endpoints require an `admin` role.

---

### REQ-8: Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Resolution latency | Each resolution MUST complete within 500ms wall-clock time (P99). If it does not, the resolution is aborted, the original error is raised, and `sla_violation` is recorded. |
| NFR-2 | Hot-path overhead | When no issues are detected (the common case), the interception layer MUST add < 1ms overhead to manifest_read or dispatch_start. |
| NFR-3 | Throughput | The resolution engine MUST sustain at least 100 resolutions/second on a single node. |
| NFR-4 | Audit durability | Audit entries are `fsync`'d before the resolution is confirmed. A crash after `fsync` but before the caller sees the resolved payload is acceptable (at-least-once semantics). |
| NFR-5 | Configuration atomicity | A partially written or syntactically invalid rules file MUST NOT be loaded; the previous valid ruleset MUST remain in effect. |
| NFR-6 | Memory | The in-memory ruleset and audit buffer MUST not exceed 50 MB under steady-state load. |
| NFR-7 | Disk | Audit log rotation MUST keep at most 30 days of entries; older logs are compressed (.gz) and retained for at most 365 days. |
| NFR-8 | Backward compatibility | When the rules file is absent, the system MUST boot with a built-in empty ruleset (no auto-resolution) — existing behaviour is unchanged. All new modules are opt-in. |

---

### REQ-9: Error Handling Matrix

| Scenario | Behaviour |
|---|---|
| Rules file missing on boot | Boot with empty ruleset; log warning; feature is inert. |
| Rules file has invalid JSON | Keep previous ruleset; log error; emit `rule_reload_total{result="invalid"}`. |
| Rule matches but action fails at runtime (e.g. version lookup for `advance_version` fails) | Log the failure in audit with `result=error`; raise the original issue as a hard error. |
| Audit log cannot be written (disk full) | Fail the parent operation (manifest_read or dispatch_start) with a hard error; auto-resolution MUST NOT proceed without an audit trail. |
| Hot-reload detects a deleted rule that is currently mid-execution | The in-flight resolution completes with the now-stale rule; the next resolution uses the new ruleset. |
| Two concurrent dispatch_start events for the same slot both detect slot_conflict | The resolver MUST serialise slot-conflict resolutions per resource class using a mutex/lease to avoid double-shifting the same slot. |
| Environment override toggles mid-flight | Takes effect for the next intercepted event; in-flight resolutions are not interrupted. |

---

### REQ-10: Acceptance Criteria — Requirements Trace

| AC # | Acceptance Criterion | Covered By |
|---|---|---|
| AC-1 | Missing defaultable field → populated from schema default, processing continues within 500ms, no user prompt. | REQ-3 (`missing_defaultable_field`), REQ-4.1 (rule `populate-defaults-manifest`), NFR-1 |
| AC-2 | Soft scheduling conflict → slot shifted by buffer, dispatch record reflects adjusted time. | REQ-3 (`slot_conflict`), REQ-4.1 (rule `shift-dispatch-slot`) |
| AC-3 | Audit log entry created synchronously with all required fields. | REQ-5 (full schema), NFR-4 (fsync) |
| AC-4 | `auto_resolution_total` increments by 1 and is immediately queryable. | REQ-6.1 |
| AC-5 | Dry-run rule: issue logged, NOT fixed, processing fails with original error. | REQ-4.3, REQ-5 (`applied: false`) |
| AC-6 | Auto-resolution disabled for `manifest_read` → same missing field is a blocking error. | REQ-4.4, REQ-6.1 (`auto_resolution_disabled_total`) |

---

### REQ-11: Integration Points in Existing Codebase

| Integration Point | Existing File(s) | How Auto-Resolution Integrates |
|---|---|---|
| Manifest loading | `src/plugins/manifest.ts` (`loadPluginManifest`) | Wrap `loadPluginManifest` with an interceptor that runs the resolver after parsing, before returning. |
| Manifest registry cache reads | `src/plugins/manifest-registry.ts` | Intercept cache-hit returns — stale cached manifests may need `dependency_lag` refresh. |
| Config validation | `src/config/validation.ts` | Manifests validated against config schema; auto-resolution of `format_coercion` and `missing_defaultable_field` occurs before validation errors are surfaced. |
| Agent dispatch | Dispatch/scheduling layer (to be identified by architect) | Hook into the dispatch initiation path to run `dispatch_start` resolution. |
| Prometheus metrics | Existing metrics infrastructure | Add new counters/histograms. |
| Admin API | Existing REST API surface | Add `/api/auto-resolution/*` routes. |
| CLI | `src/cli/` | Add `builderforce resolution-audit` subcommand. |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._