/**
 * Task progress API — computes progress, status, and completion gate results
 * realized by running the ProgressGate against PR diffs and CI state.
 *
 * Implements FR-2 / FR-3 / FR-4 / FR-5 / FR-6 by applying the gate's
 * recommended progress percent and status to tasks carrying a valid
 * deliverableType, and enforcing blocking when code/ops tasks have
 * doc-only PRs without implementation.
 */

import type {
  CompletionGateState,
  DeliverableType,
  PRDiff,
  ProjectConfig,
  TaskProgress,
  TaskStatus,
} from '@/types/Task';
import { runProgressGate } from '@/lib/gates/ProgressGate';

/**
 * Configuration for which PR options belong to which category.
 * Must be taken from pipeline.config.yaml or workspace config when available.
 * Defaults are used if config is not supplied.
 */
export interface TaskProgressConfig {
  sourceDirs?: string[];
  testPatterns?: string[];
  docPatterns?: string[];
}

/**
 * Result of applying the completion gate to a task.
 */
export interface GateAppliedResult {
  progress: number;
  status: TaskStatus;
  gateResult: CompletionGateState;
  audit: ReturnType<typeof runProgressGate>['audit'];
}

/**
 * Validates that a deliverableType is a known, recognized value.
 * Accepts strings from the backend; defaults to 'code' if unknown.
 */
export function validateDeliverableType(type: string | undefined): DeliverableType {
  if (!type) {
    return 'code';
  }
  const valid: DeliverableType[] = ['code', 'decision', 'spec', 'ops'];
  if (valid.includes(type as DeliverableType)) {
    return type as DeliverableType;
  }
  // Unknown type ⇒ log a warning (can emit to a workspace telemetry system)
  // For now, treat as 'code' to avoid blocking legitimate tasks.
  return 'code';
}

/**
 * Computes the final progress % and status for a task after applying
 * the ProgressGate.
 *
 * Process:
 * 1. Validate deliverableType (default 'code' for unknowns).
 * 2. Run ProgressGate.runProgressGate with PR diffs and CI state.
 * 3. Apply the recommended progress %, status, and block (if applicable).
 * 4. Return a TaskProgress-compatible result with audit metadata.
 */
export function applyTaskProgressGate(
  taskId: string,
  deliverableType: string | DeliverableType,
  diffs: PRDiff[] | undefined,
  allCiChecksPassing: boolean,
  currentStatus: TaskStatus,
  config: TaskProgressConfig = {}
): GateAppliedResult {
  const validatedDeliverableType = validateDeliverableType(deliverableType);
  const projectConfig: ProjectConfig = {
    sourceDirs: config.sourceDirs ?? [
      'src/',
      'lib/',
      'app/',
      'packages/',
      'components/',
      'api/',
    ],
    testPatterns: config.testPatterns ?? [
      '**/*.test.*',
      '**/*.spec.*',
      '**/tests/**',
      '**/__tests__/**',
    ],
  };

  const output = runProgressGate({
    deliverableType: validatedDeliverableType,
    diffs: diffs || [],
    allCiChecksPassing,
    currentStatus,
    projectConfig,
  });

  // If progress is 100% and gate blocks it (e.g., doc-only PR), force back to review or clamp.
  // This ensures a coding task never reaches done if blocked.
  const finalProgress = output.progress === 100 && output.gateResult.isBlocked
    ? 80 // Clamp to review progress, not done
    : output.progress;

  const finalStatus = output.status;

  return {
    progress: finalProgress,
    status: finalStatus,
    gateResult: output.gateResult,
    audit: output.audit,
  };
}

/**
 * Checks whether a task in the given status is allowed to be considered done.
 * Considers gate blocking and deliverableType, implementing FR-6's gate.
 */
export function canTaskBeDone(
  status: TaskStatus,
  gateResult: CompletionGateState,
  deliverableType: string | DeliverableType
): boolean {
  // Non-coding deliverables may complete from doc-only PRs.
  if (deliverableType === 'decision' || deliverableType === 'spec') {
    return true;
  }

  // Coding/ops tasks: done is only allowed if no gate blocking.
  if (gateResult.isBlocked) {
    return false;
  }

  return true;
}

/**
 * Computes a minimal TaskProgress snapshot suitable for internal API response.
 * Wraps the gate result with progress/percent/diagnostic data.
 */
export function computeTaskProgressBeta(
  taskId: string,
  deliverableType: string | DeliverableType,
  diffs: PRDiff[] | undefined,
  ciChecksPassing: boolean,
  status: TaskStatus,
  config: TaskProgressConfig = {}
): TaskProgress | null {
  const result = applyTaskProgressGate(
    taskId,
    deliverableType,
    diffs,
    ciChecksPassing,
    status,
    config
  );

  return {
    percent: result.progress,
    status: result.status,
    deliverableType: deliverableType as DeliverableType,
    hasImplementationCode: result.audit.conditions.hasImplementationCode,
    hasTestFiles: result.audit.conditions.hasTestFiles,
    ciChecksPassing,
    prClassification: result.gateResult.prClassification,
    sourceDirs: config.sourceDirs ?? [],
    testPatterns: config.testPatterns ?? [],
  };
}