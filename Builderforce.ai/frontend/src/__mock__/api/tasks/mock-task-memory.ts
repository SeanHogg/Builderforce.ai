/**
 * Lightweight task memory model and store (front-mock).
 * This mirrors the "Backend implementation location: Frontend mock files contain backend API logic" note from project memory.
 * It provides TypeScript models and a small in-memory store for tasks and their progress gate state.
 */

import type { CompletionGateState, PRDiff, PRFile, TaskProgress } from '@/types/Task';

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
  deliverableType: string;          // Must map to 'code' | 'decision' | 'spec' | 'ops' for the gate.
  points: number | null;
  assigneeId: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  childTaskIds: number[];
  linkedOKRIds: string[];
  progress?: Pick<TaskProgress, 'percent' | 'deliverableType'> & CompletionGateState;
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
      return Object.values(tasks).filter(t => t.projectId === projectId);
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
    files: files.map(p => ({
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
 */
export function computeTaskProgressSafe(t: TaskMemory, diffs?: PRDiff[], ciChecksPassing?: boolean): TaskProgress | undefined {
  const deliverable = t.deliverableType as 'code' | 'decision' | 'spec' | 'ops';
  const prShas = diffs?.map(d => d.sha) ?? [];
  const prClassification = diffs && diffs.length ? (diffs.every(d => d.files?.every(f => f.isDocumentation ?? false)) ? 'doc-only' : 'has-implementation') : 'none';
  const hasImplementationCode = diffs?.some(d => d.files?.some(f => !f.isDocumentation)) ?? false;
  const hasTestFiles = diffs?.some(d => d.files?.some(f => f.path.includes('.test') || f.path.includes('.spec') || f.path.includes('/tests/') || f.path.includes('__tests__'))) ?? false;

  return {
    percent: 0,
    status: t.status as any,
    deliverableType: deliverable,
    hasImplementationCode,
    hasTestFiles,
    ciChecksPassing: ciChecksPassing ?? false,
    prClassification,
    sourceDirs: ['src/', 'lib/', 'app/', 'packages/', 'components/', 'api/'],
    testPatterns: ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/__tests__/**'],
  };
}