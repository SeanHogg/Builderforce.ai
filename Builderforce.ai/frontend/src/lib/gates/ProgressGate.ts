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
  prShas: string[];
  prClassification: 'none' | 'doc-only' | 'has-implementation';
  deliverableType: DeliverableType;
  filesChanged: Pick<PRFile, 'path' | 'isDocumentation'>[];
  conditions: {
    hasImplementationCode: boolean;
    hasTestFiles: boolean;
    ciChecksPassing: boolean;
  };
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

const DEFAULT_SOURCE_DIRS = ['src/', 'lib/', 'app/', 'packages/', 'components/', 'api/'];
const DEFAULT_TEST_PATTERNS = ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/__tests__/**'];

export function classifyFile(path: string): { isDoc: boolean; isTest: boolean; isSource: boolean } {
  const isDoc = micromatch.isMatch(path, DOC_ONLY_PATTERNS, { dot: true });
  const isTest = micromatch.isMatch(path, DEFAULT_TEST_PATTERNS, { dot: true });
  const isSource =
    !isDoc &&
    !isTest &&
    (micromatch.isMatch(path, DEFAULT_SOURCE_DIRS.map(d => `${d}**`), { dot: true }) ||
      // Treat any non-doc, non-config code file outside clearly non-source paths as potential source.
      (!micromatch.isMatch(path, ['**/*.json', '**/*.yml', '**/*.yaml', '**/*.lock', '**/*.toml', '**/*.config.*', '.github/**', '.github/**/*'], { dot: true })));
  return { isDoc, isTest, isSource };
}

export function classifyPR(diff: PRDiff): 'doc-only' | 'has-implementation' {
  if (!diff.files || diff.files.length === 0) return 'doc-only';
  const allDoc = diff.files.every(f => classifyFile(f.path).isDoc);
  return allDoc ? 'doc-only' : 'has-implementation';
}

function classifyAllPRs(diffs: PRDiff[] | undefined): 'none' | 'doc-only' | 'has-implementation' {
  if (!diffs || diffs.length === 0) return 'none';
  const allDoc = diffs.every(d => classifyPR(d) === 'doc-only');
  if (allDoc) return 'doc-only';
  return 'has-implementation';
}

function computeImplementationSignals(diffs: PRDiff[]) {
  const allFiles = diffs.flatMap(d => d.files);
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
 * - Doc-only PRs on code/ops tasks are capped at 20% and routed to 'spec-ready'.
 * - Progress is earned by source files (>20%), tests (>60%), and green CI (100%).
 * - Decision/spec tasks may reach done from doc-only PRs.
 */
export function runProgressGate(input: ProgressGateInput): ProgressGateOutput {
  const { deliverableType, diffs, allCiChecksPassing, currentStatus } = input;
  const prClassification = classifyAllPRs(diffs);
  const { hasImplementationCode, hasTestFiles } = computeImplementationSignals(diffs);

  const previousProgress = inferProgressForStatus(currentStatus);

  let recommendedProgress = 0;
  let recommendedStatus: TaskStatus = currentStatus;
  let blockedReason = '';
  let diagnosis = '';

  if (deliverableType === 'decision' || deliverableType === 'spec') {
    // FR-5: written-decision deliverables may complete via doc PR.
    if (prClassification === 'doc-only' && diffs.length > 0) {
      recommendedProgress = 100;
      recommendedStatus = 'done';
      diagnosis = 'doc-only PR accepted for decision/spec deliverable';
    } else if (prClassification === 'has-implementation') {
      recommendedProgress = 90;
      recommendedStatus = 'review';
      diagnosis = 'implementation present; decision/spec deliverable treated as review';
    } else {
      recommendedProgress = 10;
      recommendedStatus = 'todo';
      diagnosis = 'no PR yet for decision/spec deliverable';
    }
  } else {
    // code / ops
    if (prClassification === 'none') {
      recommendedProgress = 5;
      recommendedStatus = currentStatus === 'done' ? 'in-progress' : currentStatus;
      diagnosis = 'no PR opened for coding task';
    } else if (prClassification === 'doc-only') {
      // FR-2 / FR-4
      recommendedProgress = 15;
      if (currentStatus === 'done') {
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
          recommendedProgress = 65;
          recommendedStatus = 'review';
          blockedReason = 'COMPLETION_BLOCKED: tests not passing';
          diagnosis = 'implementation + tests present, CI not green';
        } else {
          recommendedProgress = 100;
          recommendedStatus = 'done';
          diagnosis = 'implementation + tests + green CI';
        }
      }
    }

    if (recommendedStatus === 'done' && !allCiChecksPassing) {
      recommendedStatus = 'review';
      blockedReason = 'COMPLETION_BLOCKED: tests not passing';
      diagnosis = 'CI required for 100%';
    }
  }

  recommendedProgress = clampProgress(recommendedProgress);

  // Force progress cap to 20% on code/ops tasks when doc-only, regardless of any other signal.
  if ((deliverableType === 'code' || deliverableType === 'ops') && prClassification === 'doc-only') {
    recommendedProgress = Math.min(recommendedProgress, 20);
  }

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
    prShas: diffs.map(d => d.sha),
    prClassification,
    deliverableType,
    filesChanged: diffs.flatMap(d =>
      d.files.map(f => ({ path: f.path, isDocumentation: classifyFile(f.path).isDoc }))
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
