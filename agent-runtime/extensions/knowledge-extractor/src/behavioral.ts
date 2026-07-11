/**
 * Behavioral Extraction Mode (FR-4)
 *
 * Analyzes execution traces to detect divergence between anticipated
 * and actual action paths, classifying them into strategy changes,
 * error recoveries, and optimizations.
 */

import type {
  LearningRecord,
  RunContext,
  ExtractorConfig,
  AnticipatedAction,
  TraceAction,
} from "./types.js";

import { createLearningId, getExtractorVersion, nowISO } from "./utils.js";

/**
 * Extract behavioral learning records from the execution trace.
 * FR-4.1: Analyze trace for divergence from anticipated path.
 * FR-4.2: Classify divergence points into three types.
 * FR-4.3: Generate template-based learning descriptions.
 * FR-4.4: Confidently score behavioral records (0.3–0.75).
 * FR-4.5: Skip if no anticipated path was recorded.
 */
export function extractBehavioral(
  ctx: RunContext,
  config: ExtractorConfig,
): LearningRecord[] {
  const records: LearningRecord[] = [];

  // FR-4.5: Skip if no anticipated path
  if (ctx.anticipated_actions.length === 0) {
    return [];
  }

  // Create a map of anticipated actions by step index
  const anticipatedMap = new Map(
    ctx.anticipated_actions.map(a => [a.step_index, a])
  );

  // Track current position in anticipated path
  let currentStep = 0;

  // Process each trace action
  for (const action of ctx.execution_trace) {
    // Check if we have an anticipated action for this step
    const anticipated = anticipatedMap.get(currentStep);
    if (!anticipated) {
      break; // No more anticipated actions to compare against
    }

    // FR-4.1: Compare actual action with anticipated
    const actualTool = action.tool_name;
    const expectedTool = anticipated.expected_tool;

    if (actualTool !== expectedTool) {
      // Divergence detected
      const divergenceType = determineDivergenceType(
        anticipated, 
        action, 
        currentStep, 
        ctx.execution_trace.length
      );

      // Generate learning record
      const record: LearningRecord = {
        learning_id: createLearningId(
          ctx.run_id,
          "BEHAVIORAL",
          `${divergenceType}:${currentStep}:${actualTool}`
        ),
        run_id: ctx.run_id,
        task_id: ctx.task_id,
        agent_id: ctx.agent_id,
        trigger_event: ctx.trigger_event,
        signal_type: "BEHAVIORAL",
        change_type: divergenceType as LearningRecord["change_type"],
        content: generateDivergenceDescription(
          anticipated, 
          action, 
          divergenceType
        ),
        previous_value: anticipated.expected_tool,
        rationale: null,
        confidence_score: calculateBehavioralConfidence(divergenceType, config),
        extraction_timestamp: nowISO(),
        extractor_version: getExtractorVersion(),
        status: "CANDIDATE",
      };

      records.push(record);
    }

    currentStep++;
  }

  return records;
}

/**
 * Determine the type of divergence based on context
 * FR-4.2: Classify as STRATEGY_CHANGE, ERROR_RECOVERY, or OPTIMIZATION
 */
function determineDivergenceType(
  anticipated: AnticipatedAction,
  action: TraceAction,
  stepIndex: number,
  totalSteps: number
): DivergenceClass {
  // Simple heuristic: if the action occurred after a failure, classify as ERROR_RECOVERY
  if (action.error) {
    return "ERROR_RECOVERY";
  }

  // If this is a later step than expected, could be optimization
  if (stepIndex > anticipated.step_index) {
    return "OPTIMIZATION";
  }

  // Default to strategy change
  return "STRATEGY_CHANGE";
}

/**
 * Generate structured description of the divergence
 * FR-4.3: Use template engine for deterministic output
 */
function generateDivergenceDescription(
  anticipated: AnticipatedAction,
  action: TraceAction,
  type: DivergenceClass
): string {
  switch (type) {
    case "STRATEGY_CHANGE":
      return `Changed execution strategy at step ${anticipated.step_index}: ` +
        `expected tool "${anticipated.expected_tool}" but used "${action.tool_name}" instead`;

    case "ERROR_RECOVERY":
      return `Recovered from error at step ${anticipated.step_index}: ` +
        `expected tool "${anticipated.expected_tool}" but used "${action.tool_name}" after failure`;

    case "OPTIMIZATION":
      return `Optimized execution path at step ${anticipated.step_index}: ` +
        `skipped expected tool "${anticipated.expected_tool}" in favor of "${action.tool_name}"`;

    default:
      return `Divergence detected at step ${anticipated.step_index}: ` +
        `expected tool "${anticipated.expected_tool}" but used "${action.tool_name}"`;
  }
}

/**
 * Calculate confidence score for behavioral records
 * FR-4.4: 0.3–0.75 range with type-based weighting
 */
function calculateBehavioralConfidence(
  type: DivergenceClass,
  config: ExtractorConfig
): number {
  let baseScore = 0.5; // Midpoint of 0.3–0.75 range

  // Adjust based on divergence type
  switch (type) {
    case "STRATEGY_CHANGE":
      baseScore = 0.6; // More confident in strategic decisions
      break;
    case "ERROR_RECOVERY":
      baseScore = 0.5; // Moderate confidence
      break;
    case "OPTIMIZATION":
      baseScore = 0.4; // Lower confidence in optimizations
      break;
  }

  // Apply config overrides if present
  if (config.behavioralConfidenceFloor !== undefined) {
    baseScore = Math.max(config.behavioralConfidenceFloor, baseScore);
  }
  if (config.behavioralConfidenceCeiling !== undefined) {
    baseScore = Math.min(config.behavioralConfidenceCeiling, baseScore);
  }

  return baseScore;
}