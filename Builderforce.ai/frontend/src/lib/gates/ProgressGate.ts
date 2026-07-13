import micromatch from 'micromatch';
import type {
  CompletionGateState,
  DeliverableType,
  PRDiff,
  PRFile,
  ProjectConfig,
  TaskProgress,
  TaskStatus,
} from '@/types/Task';

export interface ProgressGateInput {
  deliverableType: DeliverableType;
  taskType: TaskType;
  diffs: PRDiff[];
  allCiChecksPassing: boolean;
  currentStatus: TaskStatus;
  projectConfig?: ProjectConfig;
}

export interface ProgressGateOutput {
  progress: number;
  status: TaskStatus;              // Recommended status, not necessarily applied.
  gateResult: CompletionGateState;
  diagnosis: string;
  audit: ProgressAuditEntry;
}

export interface ProgressAuditEntry {
  previousStatus: TaskStatus;
  recommendedStatus: TaskStatus;
  previousProgress: number;
  recommendedProgress: number;
  prClassification: 'none' | 'doc-only' | 'has-implementation';
  deliverableType: DeliverableType;
  taskType: TaskType;
  blockedReason?: string;
  timestamp: string;
}

const DOC_ONLY_PATTERNS = [
  '**/*.md',
  '**/docs/**',
  '**/*.rst',
  '**/*.txt',
  'CHANGELOG',
  'LICENSE',
  'NOTICE',
  'README*',
];

// Store pending gate checks for completion events. This is a lightweight in-memory capture; callers can serialize/store as needed.
const pendingGates: Array<{ taskId: string; gate: CompletionGateState; timestamp: string }> = [];

export function runCompletionGateCheck(input: Omit<ProgressGateInput, 'deliverableType' | 'taskType'> & {
  deliverableType: DeliverableType;
  taskType: TaskType;
}): CompletionGateState {
  pendingGates.push({
    taskId: '', // Populated when the gate is resolved in audit.
    gate: runProgressGate(input as ProgressGateInput).gateResult,
    timestamp: new Date().toISOString(),
  });
  return pendingGates[pendingGates.length - 1].gate;
}

/**
 * Helper to build audit diagnostics for runProgressGate results.
 */
function buildAuditDiagnosis(output: ProgressGateOutput): string {
  const { gateResult, diagnosis } = output;
  if (gateResult.isBlocked) {
    return `Gate blocked: ${gateResult.blockingReason}. ${diagnosis}`;
  }
  return diagnosis ?? 'Gate applied successfully';
}

// Internal exports of progress states for mainboard connections (inner-plane routing).
const DEFAULT_SOURCE_DIRS = ['src/', 'lib/', 'app/', 'packages/', 'components/', 'api/'];
const DEFAULT_TEST_PATTERNS = ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/__tests__/**'];

export function classifyFile(path: string): { isDoc: boolean; isTest: boolean; isSource: boolean } {
  const isDoc = micromatch.isMatch(path, DOC_ONLY_PATTERNS, { dot: true });
  const isTest = micromatch.isMatch(path, DEFAULT_TEST_PATTERNS, { dot: true });
  const isSource =
    !isDoc &&
    !isTest &&
    (micromatch.isMatch(path, DEFAULT_SOURCE_DIRS.map((d) => `${d}**`), { dot: true }) ||
      // Treat any non-doc, non-config code file outside clearly non-source paths as potential source.
      (!micromatch.isMatch(
        path,
        ['**/*.json', '**/*.yml', '**/*.yaml', '**/*.lock', '**/*.toml', '**/*.config.*', '.github/**', '.github/**/*'],
        { dot: true }
      )));
  return { isDoc, isTest, isSource };
}

export function classifyPR(diff: PRDiff): 'doc-only' | 'has-implementation' {
  if (!diff.files || diff.files.length === 0) return 'doc-only';
  const allDoc = diff.files.every((f) => classifyFile(f.path).isDoc);
  return allDoc ? 'doc-only' : 'has-implementation';
}

function classifyAllPRs(diffs: PRDiff[] | undefined): 'none' | 'doc-only' | 'has-implementation' {
  if (!diffs || diffs.length === 0) return 'none';
  const allDoc = diffs.every((d) => classifyPR(d) === 'doc-only');
  if (allDoc) return 'doc-only';
  return 'has-implementation';
}

function computeImplementationSignals(diffs: PRDiff[]) {
  const allFiles = diffs.flatMap((d) => d.files);
  let hasImplementationCode = false;
  let hasTestFiles = false;
  for (const file of allFiles) {
    const c = classifyFile(file.path);
    if (c.isTest) hasTestFiles = true;
    if (c.isSource) hasImplementationCode = true;
  }
  return { hasImplementationCode, hasTestFiles };
}

function clampProgress(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/**
 * Implements FR-2 / FR-3 / FR-4 / FR-5 / FR-6.
 *
 * - Doc-only PRs on code tasks are capped at ≤20% and routed to 'spec-ready'.
 * - Progress is earned by source files (>20%), tests (>60%), and green CI (100%).
 * - Decision and spec tasks may complete via doc PR (done via doc-only or has-implementation depending on task_type).
 * - Progress is enforced ≤49% on spec-ready to prevent 100% display.
 */

export function runProgressGate(input: ProgressGateInput): ProgressGateOutput {
  const { deliverableType, taskType, diffs, allCiChecksPassing, currentStatus } = input;

  const prClassification = classifyAllPRs(diffs);
  const { hasImplementationCode, hasTestFiles } = computeImplementationSignals(diffs);

  // FR-10: default for unspecified task_type is coding (per PRD FR-10).
  // Log a warning if task_type was not provided so creators know to set it explicitly.
  if (!taskType) {
    // TODO: wire to a telemetry system in the future
    // console.warn(`[ProgressGate] task_type undefined for task, defaulting to 'coding'`);
  }
  // Non-coding types (analysis, provisioning, decision, documentation) can complete without impl code.
  const effectiveTaskType = taskType ?? 'coding';

  const previousProgress = inferProgressForStatus(currentStatus);

  let recommendedProgress = 0;
  let recommendedStatus: TaskStatus = currentStatus;
  let blockedReason = '';
  let diagnosis = '';

  // FR-5: non-coding task types may complete via doc-only PR (decision/documentation); spec is done via doc-only.
  if (effectiveTaskType === 'decision') {
    if (prClassification === 'doc-only' && diffs.length > 0) {
      recommendedProgress = 100;
      recommendedStatus = 'done';
      diagnosis = 'doc-only PR accepted for decision deliverable';
    } else if (prClassification === 'has-implementation') {
      recommendedProgress = 90;
      recommendedStatus = 'review';
      diagnosis = 'implementation present; decision deliverable treated as review';
    } else {
      recommendedProgress = 10;
      recommendedStatus = 'todo';
      diagnosis = 'no PR yet for decision deliverable';
    }
  } else if (effectiveTaskType === 'documentation') {
    if (prClassification === 'doc-only' && diffs.length > 0) {
      recommendedProgress = 100;
      recommendedStatus = 'done';
      diagnosis = 'doc-only PR accepted for documentation deliverable';
    } else if (prClassification === 'has-implementation') {
      recommendedProgress = 90;
      recommendedStatus = 'review';
      diagnosis = 'implementation present; documentation deliverable treated as review';
    } else {
      recommendedProgress = 5;
      recommendedStatus = 'todo';
      diagnosis = 'no PR yet for documentation deliverable';
    }
  } else {
    // FR-4: coding, analysis, provisioning, spec may not complete via doc-only.
    if (prClassification === 'none') {
      recommendedProgress = 5;
      recommendedStatus = currentStatus === 'done' ? 'in-progress' : currentStatus;
      diagnosis = 'no PR opened for coding task';
    } else if (prClassification === 'doc-only') {
      // FR-2: cap at 20% for coding/analysis/provisioning/spec when ALL PRs are doc-only.
      // FR-4: move to spec-ready.
      recommendedProgress = 15;
      // FR-3: enforce max 49% display on spec-ready to never show 100% while blocked doc-only.
      if (currentStatus === 'spec-ready') {
        recommendedProgress = Math.min(recommendedProgress, 49);
      }
      if (currentStatus === 'done') {
        // Guard block: do not allow done from doc-only for coding/analysis/provisioning/spec per FR-4.
        blockedReason = 'COMPLETION_BLOCKED: doc-only PR, no implementation detected';
      }
      recommendedStatus = 'spec-ready';
      diagnosis = 'doc-only PR; task moved to spec-ready until implementation PR arrives';
    } else {
      // has-implementation
      if (!hasImplementationCode) {
        // Defensive fallback; should not happen if classifyPR is correct.
        recommendedProgress = 20;
        recommendedStatus = 'spec-ready';
        blockedReason = 'COMPLETION_BLOCKED: implementation PR missing source files';
        diagnosis = 'PR flagged as implementation but no recognized source files found';
      } else {
        if (!hasTestFiles) {
          recommendedProgress = 40;
          recommendedStatus = 'in-progress';
          diagnosis = 'implementation PR open, missing tests';
        } else if (!allCiChecksPassing) {
          // FR-3: require CI green for 100%.
          recommendedProgress = 65;
          recommendedStatus = 'review';
          blockedReason = 'COMPLETION_BLOCKED: tests not passing';
          diagnosis = 'implementation + tests present, CI not green';
        } else {
          // FR-3: commit done only when source + tests + CI green.
          recommendedProgress = 100;
          recommendedStatus = 'done';
          diagnosis = 'implementation + tests + green CI';
        }
      }
    }
  }

  // FR-2/F: cap progress to 20% for code tasks while all PRs are doc-only regardless of any other signal.
  if (
    (effectiveTaskType === 'coding' || effectiveTaskType === 'provisioning') &&
    prClassification === 'doc-only'
  ) {
    recommendedProgress = Math.min(recommendedProgress, 20);
  }

  recommendedProgress = clampProgress(recommendedProgress);

  const gateResult: CompletionGateState = {
    isBlocked: Boolean(blockedReason),
    blockingReason: blockedReason,
    deliverableType,
    prClassification,
  };

  const audit: ProgressAuditEntry = {
    previousStatus: currentStatus,
    recommendedStatus,
    previousProgress,
    recommendedProgress,
    prShas: diffs.map((d) => d.sha),
    prClassification,
    deliverableType,
    taskType: effectiveTaskType,
    filesChanged: diffs.flatMap((d) =>
      d.files.map((f) => ({ path: f.path, isDocumentation: classifyFile(f.path).isDoc }))
    ),
    conditions: { hasImplementationCode, hasTestFiles, ciChecksPassing: allCiChecksPassing },
    blockedReason: blockedReason || undefined,
    timestamp: new Date().toISOString(),
  };

  return {
    progress: recommendedProgress,
    status: recommendedStatus,
    gateResult,
    diagnosis,
    audit,
  };
}

function inferProgressForStatus(status: TaskStatus): number {
  switch (status) {
    case 'todo':
      return 0;
    case 'in-progress':
      return 30;
    case 'spec-ready':
      return 15;
    case 'review':
      return 80;
    case 'done':
      return 100;
    case 'blocked':
      return 10;
    case 'changes_requested':
      return 60;
    default:
      return 0;
  }
}

/**
 * Stand-alone completion gate check used by Validator agents (FR-6).
 */
export function runCompletionGate(input: ProgressGateInput): CompletionGateState {
  return runProgressGate(input).gateResult;
}