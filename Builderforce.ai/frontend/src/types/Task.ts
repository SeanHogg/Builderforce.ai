'use client';

/**
 * Core task and gate types for the BuilderForce board.
 * This file defines the interface shapes used in both the mock API and the progress/completion gate logic.
 */

export type DeliverableType = 'code' | 'decision' | 'spec' | 'ops';

export type TaskStatus = 'todo' | 'in-progress' | 'spec-ready' | 'review' | 'done' | 'blocked' | 'changes_requested';

export interface PRDiff {
  sha: string;
  isModified: boolean;
  files: PRFile[];
}

export interface PRFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  // A file is classified as 'documentation' if it matches any doc-only pattern.
  isDocumentation: boolean;
}

export interface TaskProgress {
  percent: number;
  status: TaskStatus;
  deliverableType: DeliverableType;
  hasImplementationCode: boolean;       // At least one file changed under source directories.
  hasTestFiles: boolean;                 // At least one file matching test pattern changed or added.
  ciChecksPassing: boolean;              // All required CI checks on the PR head SHA are green.
  prClassification: 'none' | 'doc-only' | 'has-implementation';
  sourceDirs: string[];                   // Recognized source directories (for progress signal).
  testPatterns: string[];                 // Recognized test file patterns (for progress signal).
}

export interface CompletionGateState {
  isBlocked: boolean;
  blockingReason: string;
  deliverableType: DeliverableType;
  prClassification: 'none' | 'doc-only' | 'has-implementation';
}

export interface ProjectConfig {
  // Recognized source directories. Extend as needed per language or policy.
  sourceDirs: string[];
  // Recognized test file patterns. Extend as needed.
  testPatterns: string[];
}

// Default global config for this workspace. In a real app, this could be fetched from an environment config or workspace API.
export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  sourceDirs: ['src/', 'lib/', 'app/', 'packages/', 'components/', 'api/'],
  testPatterns: ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/__tests__/**'],
};

// Doc-only file root patterns.
export const DOC_ROOT_PATTERNS = [
  '**/*.md', '**/docs/**', '**/*.rst', '**/*.txt', 'CHANGELOG', 'LICENSE', 'NOTICE', 'README*'];