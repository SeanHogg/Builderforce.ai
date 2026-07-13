/**
 * Gate configuration bindings with typed gate functions.
 * This file exports the gate runtime and classification helpers with a shared config shape.
 * Services import runProgressGate and classification functions here rather than scattering defaults.
 */

import micromatch from 'micromatch';
import type {
  CompletionGateState,
  PRDiff,
  PRDiff as GatePRDiff,
  TaskStatus,
} from '@/types/Task';
import { runProgressGate } from './ProgressGate';
import type { PipelineConfig } from '@/types/PipelineConfig';

/**
 * Defaults that match ProgressGate.ts defaults when no pipeline config is supplied.
 * Keep these in sync with ProgressGate.DEFAULT_SOURCE_DIRS and DEFAULT_TEST_PATTERNS.
 */
export const DEFAULT_SOURCE_DIRS = ['src/', 'lib/', 'app/', 'packages/', 'components/', 'api/'];
export const DEFAULT_TEST_PATTERNS = ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/__tests__/**'];

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

/**
 * Default pipeline configuration for task progress gate.
 * This object defines source, test, and doc patterns globally.
 * Services that must allow org overrides should pass a pipeline config explicitly.
 */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  sourceDirs: DEFAULT_SOURCE_DIRS,
  testPatterns: DEFAULT_TEST_PATTERNS,
  docPatterns: DOC_ONLY_PATTERNS,
};

/**
 * Config shape expected by the gate's internal classification.
 * It aligns with ProgressGate's ProjectConfig and exposes a shared mission.
 */
export interface GateConfig extends Parameters<typeof runProgressGate>[0]['projectConfig'] {
  /** Recognized source directories for implementation signals. */
  sourceDirs: string[];
  /** Glob patterns for test files (for progress signal). */
  testPatterns: string[];
  /** Glob patterns for documentation-only files (excluded from progress). */
  docPatterns: string[];
}

/**
 * Helper to classify a single file using the gate docs patterns.
 * Returns true if the path is doc-only (excluded from implementation signals).
 */
export function classifyFileAsDoc(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return micromatch.isMatch(normalized, DOC_ONLY_PATTERNS, { dot: true });
}

/**
 * Classifies a PR's diffs per gate configuration.
 * Returns true if at least one file is NOT documentation.
 */
export function classifyPRAsHasImplementation(diff: PRDiff): boolean {
  if (!diff.files || diff.files.length === 0) return false;
  // Prefer the global docs patterns; gate.ts already sets these.
  const hasImpl = diff.files.some((f) => !classifyFileAsDoc(f.path));
  return hasImpl;
}

/**
 * Classifies all PRs for the task.
 */
export function classifyAllPRsAsMode(diffs: PRDiff[] | undefined): 'none' | 'doc-only' | 'has-implementation' {
  if (!diffs || diffs.length === 0) return 'none';
  const hasImplementation = diffs.some((d) => classifyPRAsHasImplementation(d));
  return hasImplementation ? 'has-implementation' : 'doc-only';
}

/**
 * Typed gate runner that returns the same shape as ProgressGate.runProgressGate.
 */
export type GateOutput = ReturnType<typeof runProgressGate>;
export interface GateInputWithConfig extends Parameters<typeof runProgressGate>[0] {
  projectConfig: GateConfig;
}

/**
 * Runs the progress gate with typed input/output.
 * This helper ensures services use the correct config shape when invoking gate internals.
 */
export function runProgressGateWithConfig(input: GateInputWithConfig): GateOutput {
  return runProgressGate(input as Parameters<typeof runProgressGate>[0]);
}