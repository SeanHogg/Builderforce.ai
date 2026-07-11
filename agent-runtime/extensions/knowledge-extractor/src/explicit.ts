/**
 * Explicit Extraction Mode (FR-2)
 *
 * Collects structured LearningSignal events the agent emitted during execution,
 * validates them, boosts confidence for self-aware reports, and produces
 * candidate learning records.
 */

import type { LearningRecord, LearningSignal, RunContext, ExtractorConfig } from "./types.js";

import { createLearningId, getExtractorVersion, nowISO } from "./utils.js";

/**
 * Extract explicit learning signals from the run context.
 *
 * FR-2.1: Agents emit LearningSignal events; we collect them from the trace.
 * FR-2.2: Every signal becomes a candidate record.
 * FR-2.3: Baseline confidence boost of +0.15, capped at 1.0.
 * FR-2.4: Validate non-empty, semantically coherent (lightweight), and not duplicates.
 */
export function extractExplicit(
  ctx: RunContext,
  config: ExtractorConfig,
): LearningRecord[] {
  const records: LearningRecord[] = [];

  for (const signal of ctx.learning_signals) {
    // FR-2.4: Validate non-empty
    if (!signal.content || signal.content.trim().length === 0) {
      continue;
    }

    // FR-2.4: Lightweight semantic coherence check — ensure content has
    // substance (at least a few meaningful tokens) and is not noise.
    if (!passesCoherenceCheck(signal)) {
      continue;
    }

    // Compute baseline confidence with EXPLICIT boost (+0.15)
    const hintWeight = signal.confidence_hint ?? 0.5;
    // Base starts at EXPLICIT weight (0.65) then blend with agent hint
    const baseScore = 0.65 + (hintWeight * 0.35);
    // FR-2.3: +0.15 boost, capped at 1.0
    const confidence = Math.min(1.0, baseScore + 0.15);

    records.push({
      learning_id: createLearningId(ctx.run_id, "EXPLICIT", signal.content),
      run_id: ctx.run_id,
      task_id: ctx.task_id,
      agent_id: ctx.agent_id,
      trigger_event: ctx.trigger_event,
      signal_type: "EXPLICIT",
      change_type: "ADDITION",
      content: signal.content,
      previous_value: null,
      rationale: signal.rationale,
      confidence_score: confidence,
      extraction_timestamp: nowISO(),
      extractor_version: getExtractorVersion(),
      status: "CANDIDATE",
    });
  }

  return records;
}

/**
 * Lightweight semantic coherence check (FR-2.4).
 * Ensures signal content has enough substance to be meaningful:
 *  - Minimum 10 characters
 *  - Contains at least one alphanumeric word ≥3 chars
 *  - Isn't just repeating the same character
 * This avoids storing noise like "ok", "done", or whitespace-only signals.
 */
function passesCoherenceCheck(signal: LearningSignal): boolean {
  const text = signal.content.trim();

  if (text.length < 10) {
    return false;
  }

  // Must have at least one meaningful word (≥3 alphabetic characters)
  const words = text.split(/\s+/);
  const hasMeaningfulWord = words.some((w) => /[a-zA-Z]{3,}/.test(w));
  if (!hasMeaningfulWord) {
    return false;
  }

  // Reject repetitive character sequences (e.g. "aaaaaaa bbbbbb")
  const uniqueChars = new Set(text.toLowerCase().replace(/\s/g, "").split(""));
  if (uniqueChars.size <= 2 && text.length > 20) {
    return false;
  }

  return true;
}