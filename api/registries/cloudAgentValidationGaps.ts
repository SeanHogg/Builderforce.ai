/**
 * CLOUD AGENT VALIDATION GAP REGISTRY
 * ====================================
 * Single authoritative gap registry (FR-1.1) mapping all 50 cloud-agent
 * validation gaps to ID, title, severity, domain, and linked PRs.
 *
 * This file is the ONLY source of truth for gap IDs. Every gap references
 * its functional requirement (FR-2 through FR-8) from the PRD.
 *
 * SEVERITIES:
 *   P0 – system-breaking / security-critical (must ship before next release)
 *   P1 – high-impact reliability / security failure
 *   P2 – medium: correctness or observability gap with workaround
 *   P3 – low: cosmetic, documentation, or future-proofing
 *
 * DOMAINS map to PRD functional requirements:
 *   auth          – FR-2 (Authentication & Authorization)
 *   schema        – FR-3 (Input & Output Schema Validation)
 *   runtime       – FR-4 (Runtime State & Health Validation)
 *   error         – FR-5 (Error Handling & Propagation)
 *   observability – FR-6 (Observability Validation)
 *   resilience    – FR-7 (Resilience & Graceful Teardown)
 *   ci_cd         – FR-8 (Automated Validation & CI/CD Gates)
 *   orchestrator  – cross-cutting orchestration gaps
 */

export type GapDomain =
  | "auth"
  | "schema"
  | "runtime"
  | "error"
  | "observability"
  | "resilience"
  | "ci_cd"
  | "orchestrator";

export type GapSeverity = "P0" | "P1" | "P2" | "P3";

export interface GapMetadata {
  /** GAP-ID that identifies the gap (e.g. "GAP-AUTH-01"). */
  key: string;
  /** Human-readable, one-line title. */
  title: string;
  /** Severity per FR-1.1. */
  severity: GapSeverity;
  /** Domain per FR-1.1. */
  domain: GapDomain;
  /** Links to affected component/file(s) if known. */
  affects?: string[];
  /** Public-facing URL (e.g. enterprise-consumer portal). */
  getUrl?: string;
  /** Key metric or acceptance criteria. */
  acceptance?: string;
}

/**
 * Enum-based Gap Registry — 50 gaps total.
 * Prefix convention:
 *   GAP-AUTH-01…08 — Authentication & Authorization (FR-2)
 *   GAP-SCH-01…06  — Schema validation (FR-3)
 *   GAP-RT-01…06   — Runtime state & health (FR-4)
 *   GAP-ERR-01…07  — Error handling & propagation (FR-5)
 *   GAP-OBS-01…08  — Observability (FR-6)
 *   GAP-RES-01…06  — Resilience & graceful teardown (FR-7)
 *   GAP-CI-01…06   — CI/CD gates (FR-8)
 *   GAP-V1          — Golden-path E2E harness (cross-cutting)
 *   GAP-O4-A…O4-C  — Heartbeat/reaper orphan detection
 */
export enum Gaps {
  // ── FR-2: Authentication & Authorization (8 gaps) ──────────────────────
  /** No identity-provider validation before resource access (P0). */
  AUTH_01 = "GAP-AUTH-01",
  /** Missing RBAC enforcement at agent API boundary (P0). */
  AUTH_02 = "GAP-AUTH-02",
  /** Expired/revoked tokens do not trigger agent re-authentication (P0). */
  AUTH_03 = "GAP-AUTH-03",
  /** Secrets appear in logs, traces, or error responses (P0). */
  AUTH_04 = "GAP-AUTH-04",
  /** No structured 401 response body for unauthenticated requests (P1). */
  AUTH_05 = "GAP-AUTH-05",
  /** No structured 403 response body for unauthorized operations (P1). */
  AUTH_06 = "GAP-AUTH-06",
  /** Token rotation does not invalidate prior tokens (P1). */
  AUTH_07 = "GAP-AUTH-07",
  /** Agent identity not verified on intra-cluster calls (P2). */
  AUTH_08 = "GAP-AUTH-08",

  // ── FR-3: Input & Output Schema Validation (6 gaps) ────────────────────
  /** No ingress schema validation before request processing (P0). */
  SCH_01 = "GAP-SCH-01",
  /** No egress schema enforcement on response payloads (P0). */
  SCH_02 = "GAP-SCH-02",
  /** Schema version not declared or negotiated (P1). */
  SCH_03 = "GAP-SCH-03",
  /** Malformed input not rejected with 400 + structured error detail (P1). */
  SCH_04 = "GAP-SCH-04",
  /** Protobuf field presence not validated on binary ingress (P2). */
  SCH_05 = "GAP-SCH-05",
  /** Response contract drift not detected in CI (P2). */
  SCH_06 = "GAP-SCH-06",

  // ── FR-4: Runtime State & Health (6 gaps) ──────────────────────────────
  /** Missing /health (liveness) endpoint on agent runtime (P0). */
  RT_01 = "GAP-RT-01",
  /** Missing /ready (readiness) endpoint on agent runtime (P0). */
  RT_02 = "GAP-RT-02",
  /** Illegal state transitions not blocked or alerted (P0). */
  RT_03 = "GAP-RT-03",
  /** No heartbeat/keepalive for silent-stall detection (P1). */
  RT_04 = "GAP-RT-04",
  /** Health endpoint returns unstructured or empty response (P1). */
  RT_05 = "GAP-RT-05",
  /** Agent state not logged on transition (P2). */
  RT_06 = "GAP-RT-06",

  // ── FR-5: Error Handling & Propagation (7 gaps) ────────────────────────
  /** No canonical error taxonomy (transient/permanent/config/dependency) (P0). */
  ERR_01 = "GAP-ERR-01",
  /** Unhandled exceptions not caught at agent boundary (P0). */
  ERR_02 = "GAP-ERR-02",
  /** No retry with exponential backoff + jitter for transient errors (P1). */
  ERR_03 = "GAP-ERR-03",
  /** No circuit-breaker on downstream dependency calls (P1). */
  ERR_04 = "GAP-ERR-04",
  /** Structured error payloads inconsistent across endpoints (P1). */
  ERR_05 = "GAP-ERR-05",
  /** Permanent errors retried instead of escalated (P1). */
  ERR_06 = "GAP-ERR-06",
  /** Panic recovery missing stack context in logs (P2). */
  ERR_07 = "GAP-ERR-07",

  // ── FR-6: Observability Validation (8 gaps) ────────────────────────────
  /** No standard metric set emitted (req rate, error rate, latency p50/p95/p99) (P0). */
  OBS_01 = "GAP-OBS-01",
  /** Distributed traces missing agent-scoped spans (P0). */
  OBS_02 = "GAP-OBS-02",
  /** Structured logs missing correlation IDs / agent ID / severity (P0). */
  OBS_03 = "GAP-OBS-03",
  /** No alerting rules for P0 failure modes (P0). */
  OBS_04 = "GAP-OBS-04",
  /** Trace propagation gaps not flagged by automated span validation (P1). */
  OBS_05 = "GAP-OBS-05",
  /** Log schema conformance not validated in CI (P1). */
  OBS_06 = "GAP-OBS-06",
  /** Saturation metrics not emitted (P1). */
  OBS_07 = "GAP-OBS-07",
  /** No alerting rules for P1 failure modes (P1). */
  OBS_08 = "GAP-OBS-08",

  // ── FR-7: Resilience & Graceful Teardown (6 gaps) ──────────────────────
  /** No in-flight request drain before agent shutdown (P0). */
  RES_01 = "GAP-RES-01",
  /** Forceful kills without drain not detected or reported (P0). */
  RES_02 = "GAP-RES-02",
  /** Agent does not return to known-good state on restart (P1). */
  RES_03 = "GAP-RES-03",
  /** Data integrity not verified post-restart (P1). */
  RES_04 = "GAP-RES-04",
  /** State divergence not triggering reconciliation (P1). */
  RES_05 = "GAP-RES-05",
  /** No graceful termination on SIGTERM timeout (P2). */
  RES_06 = "GAP-RES-06",

  // ── FR-8: CI/CD Gates (6 gaps) ─────────────────────────────────────────
  /** No dedicated validation test suite covering all 50 gaps (P0). */
  CI_01 = "GAP-CI-01",
  /** Gap-related tests not a hard merge-block on PRs (P0). */
  CI_02 = "GAP-CI-02",
  /** No nightly gap-coverage report (P1). */
  CI_03 = "GAP-CI-03",
  /** P0 gap deployable without passing automated test (P0). */
  CI_04 = "GAP-CI-04",
  /** Gap IDs not linked to test cases (P1). */
  CI_05 = "GAP-CI-05",
  /** Secret-scanning gate not enforced on merge (P0). */
  CI_06 = "GAP-CI-06",

  // ── Cross-cutting Orchestrator (3 gaps) ────────────────────────────────
  /** No repeatable golden-path E2E harness for cloud agents (P0). */
  V1 = "GAP-V1",
  /** Heartbeat + reaper failing to mark orphaned executions (P0). */
  O4_A = "GAP-O4-A",
  /** Reaper not detecting stalled executions within deadline window (P1). */
  O4_B = "GAP-O4-B",
}

/**
 * Full gap registry: map every gap to its metadata.
 */
export const GAP_REGISTRY: Record<Gaps, GapMetadata> = {
  // ── FR-2: Auth ─────────────────────────────────────────────────────────
  [Gaps.AUTH_01]: {
    key: "GAP-AUTH-01",
    title: "No identity-provider validation before resource access",
    severity: "P0",
    domain: "auth",
    acceptance:
      "Every agent request is validated against an identity provider; unauthenticated requests return 401.",
  },
  [Gaps.AUTH_02]: {
    key: "GAP-AUTH-02",
    title: "Missing RBAC enforcement at agent API boundary",
    severity: "P0",
    domain: "auth",
    acceptance:
      "Unauthorized operations return 403 with structured error payload.",
  },
  [Gaps.AUTH_03]: {
    key: "GAP-AUTH-03",
    title: "Expired or revoked tokens do not trigger agent re-authentication or graceful termination",
    severity: "P0",
    domain: "auth",
    acceptance:
      "Token expiry, rotation, or revocation triggers immediate re-auth or graceful termination.",
  },
  [Gaps.AUTH_04]: {
    key: "GAP-AUTH-04",
    title: "Secrets appear in logs, traces, or error responses",
    severity: "P0",
    domain: "auth",
    acceptance:
      "Automated secret-scanning gates pass on every merge; zero secrets in log/trace/error payloads.",
  },
  [Gaps.AUTH_05]: {
    key: "GAP-AUTH-05",
    title: "No structured 401 response body for unauthenticated requests",
    severity: "P1",
    domain: "auth",
    acceptance:
      "All 401 responses include structured error payload with error code and message.",
  },
  [Gaps.AUTH_06]: {
    key: "GAP-AUTH-06",
    title: "No structured 403 response body for unauthorized operations",
    severity: "P1",
    domain: "auth",
    acceptance:
      "All 403 responses include structured error payload with error code and message.",
  },
  [Gaps.AUTH_07]: {
    key: "GAP-AUTH-07",
    title: "Token rotation does not invalidate prior tokens",
    severity: "P1",
    domain: "auth",
    acceptance:
      "Rotated tokens are immediately invalidated; prior tokens rejected with 401.",
  },
  [Gaps.AUTH_08]: {
    key: "GAP-AUTH-08",
    title: "Agent identity not verified on intra-cluster calls",
    severity: "P2",
    domain: "auth",
    acceptance:
      "All intra-cluster agent-to-agent calls carry and validate agent identity tokens.",
  },

  // ── FR-3: Schema ───────────────────────────────────────────────────────
  [Gaps.SCH_01]: {
    key: "GAP-SCH-01",
    title: "No ingress schema validation before request processing",
    severity: "P0",
    domain: "schema",
    acceptance:
      "All agent ingress payloads validated against versioned JSON/Protobuf schemas; malformed input returns 400.",
  },
  [Gaps.SCH_02]: {
    key: "GAP-SCH-02",
    title: "No egress schema enforcement on response payloads",
    severity: "P0",
    domain: "schema",
    acceptance:
      "All agent egress payloads conform to published response contract; violations raise validation error.",
  },
  [Gaps.SCH_03]: {
    key: "GAP-SCH-03",
    title: "Schema version not declared or negotiated",
    severity: "P1",
    domain: "schema",
    acceptance:
      "Schema versions explicitly declared and negotiated; version mismatches do not cause silent data loss.",
  },
  [Gaps.SCH_04]: {
    key: "GAP-SCH-04",
    title: "Malformed input not rejected with structured error detail",
    severity: "P1",
    domain: "schema",
    acceptance:
      "All 400 responses for malformed input include field-level validation errors.",
  },
  [Gaps.SCH_05]: {
    key: "GAP-SCH-05",
    title: "Protobuf field presence not validated on binary ingress",
    severity: "P2",
    domain: "schema",
    acceptance:
      "Binary protobuf ingress validated for required field presence before processing.",
  },
  [Gaps.SCH_06]: {
    key: "GAP-SCH-06",
    title: "Response contract drift not detected in CI",
    severity: "P2",
    domain: "schema",
    acceptance:
      "CI pipeline detects schema drift between code and published contract; merge blocked on drift.",
  },

  // ── FR-4: Runtime ──────────────────────────────────────────────────────
  [Gaps.RT_01]: {
    key: "GAP-RT-01",
    title: "Missing /health (liveness) endpoint on agent runtime",
    severity: "P0",
    domain: "runtime",
    acceptance:
      "Every agent exposes /health returning structured status object; missing response triggers alert.",
  },
  [Gaps.RT_02]: {
    key: "GAP-RT-02",
    title: "Missing /ready (readiness) endpoint on agent runtime",
    severity: "P0",
    domain: "runtime",
    acceptance:
      "Every agent exposes /ready returning structured status object; not-ready state blocks traffic.",
  },
  [Gaps.RT_03]: {
    key: "GAP-RT-03",
    title: "Illegal state transitions not blocked or alerted",
    severity: "P0",
    domain: "runtime",
    acceptance:
      "Agent state transitions (idle→active→draining→stopped) are validated; illegal transitions blocked and alerted.",
  },
  [Gaps.RT_04]: {
    key: "GAP-RT-04",
    title: "No heartbeat or keepalive for silent-stall detection",
    severity: "P1",
    domain: "runtime",
    acceptance:
      "Heartbeat mechanism detects and flags agents that stopped processing without reporting failure.",
  },
  [Gaps.RT_05]: {
    key: "GAP-RT-05",
    title: "Health endpoint returns unstructured or empty response",
    severity: "P1",
    domain: "runtime",
    acceptance:
      "Health and readiness endpoints return structured JSON with status, uptime, and dependency checks.",
  },
  [Gaps.RT_06]: {
    key: "GAP-RT-06",
    title: "Agent state not logged on transition",
    severity: "P2",
    domain: "runtime",
    acceptance:
      "Every state transition emits a structured log line with agent ID, previous state, and new state.",
  },

  // ── FR-5: Error ────────────────────────────────────────────────────────
  [Gaps.ERR_01]: {
    key: "GAP-ERR-01",
    title: "No canonical error taxonomy (transient/permanent/config/dependency)",
    severity: "P0",
    domain: "error",
    acceptance:
      "All errors classified into canonical taxonomy and surfaced with consistent structured payloads.",
  },
  [Gaps.ERR_02]: {
    key: "GAP-ERR-02",
    title: "Unhandled exceptions not caught at agent boundary",
    severity: "P0",
    domain: "error",
    acceptance:
      "Unhandled exceptions and panics caught at boundary, logged with full context, converted to structured errors.",
  },
  [Gaps.ERR_03]: {
    key: "GAP-ERR-03",
    title: "No retry with exponential backoff and jitter for transient errors",
    severity: "P1",
    domain: "error",
    acceptance:
      "Transient errors trigger retry with exponential backoff + jitter; max retries configurable per call.",
  },
  [Gaps.ERR_04]: {
    key: "GAP-ERR-04",
    title: "No circuit-breaker on downstream dependency calls",
    severity: "P1",
    domain: "error",
    acceptance:
      "Timeouts and circuit-breakers configured and validated on every dependency call; unbounded blocking impossible.",
  },
  [Gaps.ERR_05]: {
    key: "GAP-ERR-05",
    title: "Structured error payloads inconsistent across endpoints",
    severity: "P1",
    domain: "error",
    acceptance:
      "All error responses share a canonical envelope: { error: { code, message, details? } }.",
  },
  [Gaps.ERR_06]: {
    key: "GAP-ERR-06",
    title: "Permanent errors retried instead of escalated",
    severity: "P1",
    domain: "error",
    acceptance:
      "Permanent errors escalate immediately without retry; retry budget not consumed on 4xx-class errors.",
  },
  [Gaps.ERR_07]: {
    key: "GAP-ERR-07",
    title: "Panic recovery missing stack context in logs",
    severity: "P2",
    domain: "error",
    acceptance:
      "All panic-recovery log lines include stack trace, agent ID, and correlation ID.",
  },

  // ── FR-6: Observability ────────────────────────────────────────────────
  [Gaps.OBS_01]: {
    key: "GAP-OBS-01",
    title: "No standard metric set emitted (request rate, error rate, latency percentiles)",
    severity: "P0",
    domain: "observability",
    acceptance:
      "Every agent emits request rate, error rate, latency p50/p95/p99, and saturation to central platform.",
  },
  [Gaps.OBS_02]: {
    key: "GAP-OBS-02",
    title: "Distributed traces missing agent-scoped spans",
    severity: "P0",
    domain: "observability",
    acceptance:
      "Distributed traces include agent-scoped spans with required attribute fields.",
  },
  [Gaps.OBS_03]: {
    key: "GAP-OBS-03",
    title: "Structured logs missing correlation IDs, agent ID, or severity",
    severity: "P0",
    domain: "observability",
    acceptance:
      "Every log line includes correlation ID, agent ID, environment, and severity.",
  },
  [Gaps.OBS_04]: {
    key: "GAP-OBS-04",
    title: "No alerting rules for P0 failure modes",
    severity: "P0",
    domain: "observability",
    acceptance:
      "Alerting rules exist and fire for every P0 failure mode in the gap registry.",
  },
  [Gaps.OBS_05]: {
    key: "GAP-OBS-05",
    title: "Trace propagation gaps not flagged by automated span validation",
    severity: "P1",
    domain: "observability",
    acceptance:
      "Automated span validation flags gaps in trace propagation; zero gaps in staging traffic replay.",
  },
  [Gaps.OBS_06]: {
    key: "GAP-OBS-06",
    title: "Log schema conformance not validated in CI",
    severity: "P1",
    domain: "observability",
    acceptance:
      "CI pipeline validates log schema conformance; non-conforming log lines block merge.",
  },
  [Gaps.OBS_07]: {
    key: "GAP-OBS-07",
    title: "Saturation metrics not emitted",
    severity: "P1",
    domain: "observability",
    acceptance:
      "Every agent emits saturation metric (queue depth, connection pool usage, memory pressure).",
  },
  [Gaps.OBS_08]: {
    key: "GAP-OBS-08",
    title: "No alerting rules for P1 failure modes",
    severity: "P1",
    domain: "observability",
    acceptance:
      "Alerting rules exist and fire for every P1 failure mode; alert coverage gaps treated as open P1s.",
  },

  // ── FR-7: Resilience ───────────────────────────────────────────────────
  [Gaps.RES_01]: {
    key: "GAP-RES-01",
    title: "No in-flight request drain before agent shutdown",
    severity: "P0",
    domain: "resilience",
    acceptance:
      "Agents drain in-flight requests before shutdown; forceful kills without drain detected and reported.",
  },
  [Gaps.RES_02]: {
    key: "GAP-RES-02",
    title: "Forceful kills without drain not detected or reported",
    severity: "P0",
    domain: "resilience",
    acceptance:
      "Every forceful kill (SIGKILL without prior SIGTERM drain) logged and alerted as an incident.",
  },
  [Gaps.RES_03]: {
    key: "GAP-RES-03",
    title: "Agent does not return to known-good state on restart",
    severity: "P1",
    domain: "resilience",
    acceptance:
      "Restart and recovery sequences validated; agents return to known-good state without manual intervention.",
  },
  [Gaps.RES_04]: {
    key: "GAP-RES-04",
    title: "Data integrity not verified post-restart",
    severity: "P1",
    domain: "resilience",
    acceptance:
      "Post-restart data integrity check runs automatically; divergence triggers reconciliation.",
  },
  [Gaps.RES_05]: {
    key: "GAP-RES-05",
    title: "State divergence not triggering reconciliation",
    severity: "P1",
    domain: "resilience",
    acceptance:
      "Any state divergence detected post-restart triggers automated reconciliation, never silent continuation.",
  },
  [Gaps.RES_06]: {
    key: "GAP-RES-06",
    title: "No graceful termination on SIGTERM timeout",
    severity: "P2",
    domain: "resilience",
    acceptance:
      "Agent responds to SIGTERM within drain deadline; exceeding deadline logs warning before force-kill.",
  },

  // ── FR-8: CI/CD ────────────────────────────────────────────────────────
  [Gaps.CI_01]: {
    key: "GAP-CI-01",
    title: "No dedicated validation test suite covering all 50 gaps",
    severity: "P0",
    domain: "ci_cd",
    acceptance:
      "Dedicated validation test suite covers all 50 gaps; each test linked to its gap ID.",
  },
  [Gaps.CI_02]: {
    key: "GAP-CI-02",
    title: "Gap-related tests not a hard merge-block on PRs",
    severity: "P0",
    domain: "ci_cd",
    acceptance:
      "Full validation suite runs on every PR targeting agent services; failing gap test is a hard merge-block.",
  },
  [Gaps.CI_03]: {
    key: "GAP-CI-03",
    title: "No nightly gap-coverage report",
    severity: "P1",
    domain: "ci_cd",
    acceptance:
      "Nightly full regression runs produce gap-coverage report published to team dashboard.",
  },
  [Gaps.CI_04]: {
    key: "GAP-CI-04",
    title: "P0 gap deployable without passing automated test",
    severity: "P0",
    domain: "ci_cd",
    acceptance:
      "No P0-severity gap may be deployed to production without a passing automated test covering that gap.",
  },
  [Gaps.CI_05]: {
    key: "GAP-CI-05",
    title: "Gap IDs not linked to test cases",
    severity: "P1",
    domain: "ci_cd",
    acceptance:
      "Every test case in the validation suite carries its linked gap ID in the test name or annotation.",
  },
  [Gaps.CI_06]: {
    key: "GAP-CI-06",
    title: "Secret-scanning gate not enforced on merge",
    severity: "P0",
    domain: "ci_cd",
    acceptance:
      "Automated secret-scanning gate passes on every merge; findings block merge with P0 severity.",
  },

  // ── Cross-cutting Orchestrator ─────────────────────────────────────────
  [Gaps.V1]: {
    key: "GAP-V1",
    title:
      "No repeatable golden-path E2E harness for cloud agents across all engines",
    severity: "P0",
    domain: "orchestrator",
    acceptance:
      "A single scripted `pnpm qa:cloud-agents` run that asserts all P0 checks across engine surfaces.",
  },
  [Gaps.O4_A]: {
    key: "GAP-O4-A",
    title:
      "Heartbeat + reaper failing to mark orphaned executions as failed",
    severity: "P0",
    domain: "orchestrator",
    acceptance:
      "Orphaned executions (no heartbeat within deadline) are marked failed and alerted within 60s.",
  },
  [Gaps.O4_B]: {
    key: "GAP-O4-B",
    title:
      "Reaper not detecting stalled executions within deadline window",
    severity: "P1",
    domain: "orchestrator",
    acceptance:
      "Executions with stale heartbeat but not yet past deadline are flagged as at-risk, not failed.",
  },
  [Gaps.O4_C]: {
    key: "GAP-O4-C",
    title:
      "Reaper emitting false-positive dead-execution marks",
    severity: "P1",
    domain: "orchestrator",
    acceptance:
      "Healthy executions with recent heartbeats are never marked as orphaned; false-positive rate is zero.",
  },
};

/**
 * Get full metadata for a gap. Returns null if the key is not in the registry.
 */
export function getGapMetadata(key: string): GapMetadata | null {
  return GAP_REGISTRY[key as Gaps] ?? null;
}

/**
 * List all gaps by severity.
 */
export function listGapsBySeverity(severity: GapSeverity): Gaps[] {
  return Object.values(Gaps).filter(
    (g) => GAP_REGISTRY[g].severity === severity,
  );
}

/**
 * List all gaps by domain.
 */
export function listGapsByDomain(domain: GapDomain): Gaps[] {
  return Object.values(Gaps).filter(
    (g) => GAP_REGISTRY[g].domain === domain,
  );
}

/**
 * Count gaps at each severity level.
 */
export function gapSeverityCounts(): Record<GapSeverity, number> {
  const counts: Record<GapSeverity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const g of Object.values(Gaps)) {
    counts[GAP_REGISTRY[g].severity]++;
  }
  return counts;
}

/**
 * Total number of gaps in the registry (must equal 50 per PRD).
 */
export const TOTAL_GAPS = Object.values(Gaps).length;
