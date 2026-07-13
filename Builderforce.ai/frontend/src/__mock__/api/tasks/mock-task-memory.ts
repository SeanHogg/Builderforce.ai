/**
 * Lightweight task memory model and store (front-mock).
 * This mirrors the Backend implementation location: Frontend mock files contain backend API logic.
 * It provides TypeScript models and a small in-memory store for tasks and their progress gate state.
 */

import type { CompletionGateState, EventLogEntry, PRDiff, PRFile, TaskProgress } from '@/types/Task';

/**
 * In-memory representation of a task as it exists in task memory.
 */
export interface TaskMemory {
  id: string;
  projectId: number;
  key: string;
  title: string;
  description: string;
  status: string;                    // Board lane/status (string to accommodate any external statuses).
  taskType: string;                  // Valid: 'coding' | 'analysis' | 'provisioning' | 'decision' | 'documentation'; PRD FR-4.
  deliverableType: string;          // Must map to 'code' | 'decision' | 'spec' | 'ops' for the gate.
  points: number | null;
  assigneeId: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  childTaskIds: number[];
  linkedOKRIds: string[];
  progress?: Pick<TaskProgress, 'percent' | 'deliverableType'> & CompletionGateState;
  /**
   * Audit events for progress/blocking changes (FR-7).
   * Each entry corresponds to a single gate application or blocked completion attempt.
   */
  auditLog: EventLogEntry[];
}

/**
 * In-memory task store (tiny single-file store for demo purposes).
 * In a full app this would be persisted to a database and orchestrated via a central service.
 */
export function createMockTaskStore() {
  const tasks: Record<string, TaskMemory> = {};

  return {
    get(taskId: string): TaskMemory | undefined {
      return tasks[taskId] ?? undefined;
    },

    set(task: TaskMemory): void {
      tasks[task.id] = { ...task };
    },

    delete(taskId: string): void {
      delete tasks[taskId];
    },

    list(projectId: number): TaskMemory[] {
      return Object.values(tasks).filter((t) => t.projectId === projectId);
    },
  };
}

/**
 * Helper to compute a minimal PRDiff given a SHA and a list of file paths (for testing and demo).
 */
export function createPRDiff(sha: string, files: string[]): PRDiff {
  return {
    sha,
    isModified: true,
    files: files.map((p) => ({
      path: p,
      status: p.endsWith('md') || p.includes('/docs/') || p.endsWith('.rst') || p === 'CHANGELOG' || p === 'LICENSE' || p === 'NOTICE' || p.startsWith('README') ? 'M' : 'A',
      additions: 1,
      deletions: 0,
      isDocumentation: p.endsWith('md') || p.includes('/docs/') || p.endsWith('.rst') || p === 'CHANGELOG' || p === 'LICENSE' || p === 'NOTICE' || p.startsWith('README'),
    })),
  };
}

/**
 * Build a pseudo-TaskProgress from a TaskMemory + optional diffs & CI state.
 * This function enforces the gate's invariants: progress ≤49% when status is spec-ready while all PRs are doc-only,
 * and it respects the PRD's credit mapping (none=5/no diff, doc-only=15, source=40, source+tests=65, source+tests+CI=100).
 */
export function computeTaskProgressSafe(t: TaskMemory, diffs?: PRDiff[], ciChecksPassing?: boolean): TaskProgress | undefined {
  const deliverable = t.deliverableType as 'code' | 'decision' | 'spec' | 'ops';
  const prShas = diffs?.map((d) => d.sha) ?? [];
  const prClassification = diffs && diffs.length ? (diffs.every((d) => d.files?.every((f) => f.isDocumentation ?? false)) ? 'doc-only' : 'has-implementation') : 'none';
  const hasImplementationCode = diffs?.some((d) => d.files?.some((f) => !f.isDocumentation)) ?? false;
  const hasTestFiles = diffs?.some((d) => d.files?.some((f) => f.path.includes('.test') || f.path.includes('.spec') || f.path.includes('/tests/') || f.path.includes('__tests__'))) ?? false;

  const status = t.status as any;
  let percent = 0;
  switch (status) {
    case 'todo':
      percent = 0;
      break;
    case 'in-progress':
      percent = 30;
      break;
    case 'spec-ready':
      // PRD FR-3: inner logic uses lower bound 15 for spec-ready; enforced from PR.
      percent = 15;
      break;
    case 'review':
      percent = 80;
      break;
    case 'done':
      percent = 100;
      break;
    case 'blocked':
      percent = 10;
      break;
    case 'changes_requested':
      percent = 60;
      break;
    default:
      percent = 0;
  }

  // PRD FR-2: cap at 20% for code/provisioning when all PRs are doc-only.
  if (
    prClassification === 'doc-only' &&
    (t.taskType === 'coding' || t.taskType === 'provisioning')
  ) {
    percent = Math.min(percent, 20);
  }

  // PRD FR-3: enforce max 49% on spec-ready while blocked doc-only.
  if (status === 'spec-ready' && prClassification === 'doc-only') {
    percent = Math.min(percent, 49);
  }

  // Apply on top of credit levels:
  // - none: guard (5) applied at inference; at write time use 5.
  // - doc-only: 15 (clamped if code/provisioning; capped if spec-ready).
  // - source only: 40.
  // - source + tests: 65 (or 85 per PRD if CI green; accordingly:
  //   - low 65 is used when only source+tests open, regardless of CI.
  //   - high 85 marks source+tests+green open (not commit).
  if (prClassification === 'none') {
    percent = 5;
  } else if (prClassification === 'doc-only') {
    percent = 15;
  } else if (hasImplementationCode) {
    if (!hasTestFiles) {
      percent = 40;
    } else if (ciChecksPassing) {
      percent = 85;
    } else {
      percent = 65;
    }
  }

  // Cap final at 100.
  percent = Math.min(100, percent);

  return {
    percent,
    status: status as any,
    deliverableType: deliverable,
    hasImplementationCode,
    hasTestFiles,
    ciChecksPassing: ciChecksPassing ?? false,
    prClassification,
    sourceDirs: ['src/', 'lib/', 'app/', 'packages/', 'components/', 'api/'],
    testPatterns: ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/__tests__/**'],
  };
}