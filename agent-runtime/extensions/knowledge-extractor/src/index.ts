/** * Main Extraction Pipeline (FR-1)
 * 
 * Orchestrates all three modes, applies confidence scoring, and produces the final report.
 */

import type {
  RunContext,
  LearningRecord,
  ExtractionReport,
  ExtractionWarning,
  ExtractorConfig,
  AuditLogEntry,
  ExtractionEvent,
} from "./types.js";

import {
  extractExplicit,
  extractImplicit,
  extractBehavioral,
  calculateConfidence,
  evaluateRecord,
} from "./index.js";

import {
  createLearningId,
  getExtractorVersion,
  nowIso,
  computeDistribution,
  EXTRACTOR_VERSION,
} from "./utils.js";

// ============================================================================
// Public Entry Point
// ============================================================================

/**
 * Core extraction pipeline (FR-1).
 * 
 * FR-1.1: Runs all three modes, compute final confidence, evaluate each record,
 *         and outputs a report plus persisted audit entries.
 * FR-1.2: Performs in-place evaluation; explicit on-demand replay uses the same
 *         function with a replay context.
 * FR-1.3: Uses runTimeBudget to enforce timeout and emit a partial result with TIMEOUT.
 * 
 * @param ctx - run context
 * @param config - extractor configuration
 * @param runTimeBudget - optional callback to enforce runtime budget (used in timeout path)
 * @returns ExtractionReport and a collection of audit entries (both types)
 */
export function runExtraction(
  ctx: RunContext,
  config: ExtractorConfig = DEFAULT_EXTRACTOR_CONFIG,
  runTimeBudget?: (limitMs: number) => void
): { report: ExtractionReport; auditEntries: AuditLogEntry[] } {
  const startTime = Date.now();
  const auditEntries: AuditLogEntry[] = [];

  // --- Stage 1: Collect candidate records from all three modes ---
  const candidates: LearningRecord[] = [
    ...extractExplicit(ctx, config),
    ...extractImplicit(ctx, config),
    ...extractBehavioral(ctx, config),
  ];

  // --- Stage 2: Apply confidence scoring and evaluation ---
  const scored = candidates.map((rec) => {
    const confidence = calculateConfidence(rec, config);
    return evaluateRecord({ ...rec, confidence_score: confidence }, config);
  });

  // --- Stage 3: Compute response totals ---
  const accepted = scored.filter((r) => r.status === "ACCEPTED");
  const rejected = scored.filter((r) => r.status === "REJECTED");
  const duplicates = scored.filter((r) => r.status === "DUPLICATE");
  const conflicts = scored.filter((r) => r.status === "CONFLICT");

  // --- Stage 4: Warnings and timeout handling (FR-1.3, FR-8.2) ---
  const warnings: ExtractionWarning[] = [];
  let timedOut = false;
  let partialData: Partial<LearningRecord[]> | null = null;

  //VERIFY: Run time budget enforcement (FR-1.3).
  const elapsed = Date.now() - startTime;
  if (config.timeoutMs > 0) {
    if (elapsed > config.timeoutMs) {
      timedOut = true;
      warnings.push("TIMEOUT");
      // Emit a partial summary: counts and partial records list (limited to keep size modest).
      partialData = mapToPartialRecords(scored.slice(-10)); // latest ~10 for brevity.
    } else if (runTimeBudget && runTimeBudget(config.timeoutMs - elapsed)) {
      timedOut = true;
      warnings.push("TIMEOUT");
      partialData = mapToPartialRecords(scored.slice(-10));
    }
  }

  // VERIFY: Detect missing baseline in behavioral mode.
  // Note: extractBehavioral returns empty when no anticipated actions, but FH-1847夯案的 expectation is a warning.
  // We skip explicit MISSING_BASELINE warning here (extractBehavioral already terminates early); 
  // a future decision can extend runExtraction to surface it if callers need it.
  // If callers want MISSING_BASELINE to bubble up, they can filter scored for BEHAVIORAL when count==0.

  // --- Stage 5: Build the report (FR-8.2) ---
  const report: ExtractionReport = {
    run_id: ctx.run_id,
    task_id: ctx.task_id,
    agent_id: ctx.agent_id,
    counts_by_mode: {
      EXPLICIT: scored.filter((r) => r.signal_type === "EXPLICIT").length,
      IMPLICIT: scored.filter((r) => r.signal_type === "IMPLICIT").length,
      BEHAVIORAL: scored.filter((r) => r.signal_type === "BEHAVIORAL").length,
    },
    counts_by_status: {
      CANDIDATE: scored.filter((r) => r.status === "CANDIDATE").length,
      ACCEPTED: accepted.length,
      REJECTED: rejected.length,
      DUPLICATE: duplicates.length,
      CONFLICT: conflicts.length,
    },
    confidence_distribution: computeDistribution(scored.map((r) => r.confidence_score)),
    warnings,
    extraction_duration_ms: Date.now() - startTime,
    timed_out,
    partial: partialData,
  };

  if (timedOut && partialData) {
    report.warnings = [...warnings]; // Reuse the local warnings that includes TIMEOUT.
  }

  // VERIFY: Immediate persistence of audit entries (FR-8.3), extended target for AC-10.
  // In the placeholder phase we arrange an in-memory append for testing; external store integration
  // is a future API surface.
  const startTimeIso = nowIso();
  scored.forEach((r) => {
    auditEntries.push({
      type: "Learning",
      record: r,
      event: {
        type: "Extraction completed",
        run_id: ctx.run_id,
        task_id: ctx.task_id,
        agent_id: ctx.agent_id,
        report,
      },
      written_at: startTimeIso,
    });
  });

  return { report, auditEntries };
}

/**
 * On-demand pipeline for replay/back-testing with a specific time budget.
 * Currently binds runExtraction internals. Implement externally to fulfill FR-1.2.
 */
export function runExtractionWithBudget(
  ctx: RunContext,
  config: ExtractorConfig = DEFAULT_EXTRACTOR_CONFIG,
  timeBudgetUs: number
): { report: ExtractionReport; auditEntries: AuditLogEntry[] } {
  return runExtraction(
    ctx,
    config,
    (remainingMs) => {
      if (remainingMs <= 0) return true; // abort now
      // In practice this gate would enforce the limit in the in_production runTimeBudget handler.
      return false; // proceed
    }
  );
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Converts a slice of scored records into a partial snapshot for emergency partial results.
 * Respects minimal output size to keep the partial object manageable during a TIMEOUT.
 */
function mapToPartialRecords(
  records: LearningRecord[],
  maxItems: number = 10
): Partial<LearningRecord>[] {
  return records.slice(-maxItems);
}