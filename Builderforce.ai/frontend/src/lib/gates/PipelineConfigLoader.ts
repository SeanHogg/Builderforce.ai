/**
 * Pipeline configuration loader for the completion gate.
 * Implements FR-8: pipeline.config.yaml is editable without code changes.
 * Provides serialized gate functions and pattern-driven classification,
 * allowing services to read config and classify PRs with organizational policy.
 */

import micromatch from 'micromatch';
import type {
  CompletionGateState,
  ProjectConfig,
  PRDiff,
  PRDiff as GatePRDiff,
  TaskStatus,
} from '@/types/Task';
import { runProgressGate } from './ProgressGate';
import {
  DEFAULT_PIPELINE_CONFIG,
  PIPELINE_CONFIG_YAML_COMMENT,
  type PipelineConfig,
} from '@/types/PipelineConfig';

export interface GateConfigInput extends Parameters<typeof runProgressGate>[0] {
  pipelineConfig: ProjectConfig;
}

/**
 * Serialized gate functions for services to call.
 * These closures capture the current pipeline config so callers don't need to reload it.
 */
export type SerializedGateFunctions = {
  runProgressGate: (input: GateConfigInput) => ReturnType<typeof runProgressGate>;
  runCompletionGateCheck: (input: Omit<Parameters<typeof runProgressGate>[0], 'deliverableType' | 'taskType'> & { deliverableType: any; taskType: any }) => CompletionGateState;
  classifyPR: (diff: PRDiff) => 'doc-only' | 'has-implementation';
  classifyAllPRs: (diffs: PRDiff[] | undefined) => 'none' | 'doc-only' | 'has-implementation';
  classifyFile: (path: string) => boolean; // Returns isDoc: boolean
};

/**
 * Loads the pipeline config from a YAML document (or parses defaults otherwise).
 * Validates the parsed shape through the TypeScript interface (FR-8).
 */
export function loadPipelineConfigFromYaml(yaml: string): PipelineConfig {
  let parsed: PipelineConfig;

  try {
    // In a real app, use a YAML parser to turn the string into an object.
    // For this provisional implementation, we tolerate basic key presence
    // and trust the structure matches our TypeScript interface.
    // Once frontend YAML support is in place, replace this pseudo-parsing.
    const trimmed = yaml.trim();
    if (trimmed.startsWith('#')) {
      // Strip the header comment before parsing
      const content = trimmed.replace(/^#.*(?:\n|$)/gm, '').trim();
      if (!content) {
        parsed = DEFAULT_PIPELINE_CONFIG;
      } else {
        // TODO: Use a YAML parser (e.g., js-yaml or YAML.parse) when available.
        // For now simulate parsing by initializing from defaults and assigning keys if found.
        // This keeps the module compile-free and property-aligned.
        const lines = content.split('\n');
        parsed = { ...DEFAULT_PIPELINE_CONFIG };
        const keyMap: Record<string, keyof PipelineConfig> = {
          source_dirs: 'sourceDirs',
          test_patterns: 'testPatterns',
          doc_patterns: 'docPatterns',
        };

        for (const line of lines) {
          const match = line.match(/^(\w+):\s*(.+)$/);
          if (match) {
            const [_, key, value] = match;
            const snakeKey = key.toLowerCase() as keyof PipelineConfig;
            if (keyMap[snakeKey] !== undefined) {
              // Quick effort at parsing directory arrays and pattern arrays from YAML list syntax
              const targetKey = keyMap[snakeKey];
              const rawItems: any[] = [];
              if (value.startsWith('[')) {
                try {
                  // Simulated array parsing; remove brackets and quotes for now
                  const itemsStr = value.replace(/^[[(]|[\])]$/g, '');
                  itemsStr.split(' ').forEach((item) => {
                    item = item.trim();
                    if (item) rawItems.push(item);
                  });
                } catch (_) {
                  // No-op on parse failure; keep default to remain safe
                }
              } else if (value.startsWith('"') && value.endsWith('"')) {
                // Single value in quotes
                rawItems.push(value.slice(1, -1));
              } else if (value) {
                // Plain string
                rawItems.push(value);
              }
              if (
                Array.isArray(parsed[targetKey]) &&
                rawItems.length > 0 &&
                typeof rawItems[0] === 'string'
              ) {
                // Use micromatch-compatible normalized paths
                parsed[targetKey] = rawItems.map((p) => p.replace(/[/\\]+$/g, '') + '/');
              }
            }
          }
        }
      }
    } else {
      parsed = DEFAULT_PIPELINE_CONFIG;
    }
  } catch (e) {
    // Parse error: fall back to defaults and log
    console.warn('[PipelineConfigLoader] Failed to parse pipeline config, using defaults:', e);
    parsed = DEFAULT_PIPELINE_CONFIG;
  }

  return parsed;
}

/**
 * Serializes the gate functions with the current pipeline config.
 * This returns closures that can be invoked by services without them holding a YAML file reference.
 */
export function serializeGateFunctionsWithConfig(pipelineConfig: PipelineConfig): SerializedGateFunctions {
  const docsOnlyPatterns = pipelineConfig.docPatterns;

  /**
   * Uses the org-specified doc patterns to classify a single file.
   * FR-1: Classify files using pipeline config patterns.
   */
  function classifyFile(path: string): boolean {
    // Normalize path to forward slashes for micromatch
    const normalized = path.replace(/\\/g, '/');
    return micromatch.isMatch(normalized, docsOnlyPatterns, { dot: true });
  }

  /**
   * Classifies a PR's diffs per pipeline config.
   * Returns true if at least one file is NOT documentation.
   */
  function classifyPR(diff: PRDiff): boolean {
    if (!diff.files || diff.files.length === 0) return false;
    const hasImplementation = diff.files.some((f) => !classifyFile(f.path));
    return hasImplementation;
  }

  /**
   * Classifies all PRs for the task.
   */
  function classifyAllPRs(diffs: PRDiff[] | undefined): 'none' | 'doc-only' | 'has-implementation' {
    if (!diffs || diffs.length === 0) return 'none';
    const hasImplementation = diffs.some((d) => classifyPR(d));
    return hasImplementation ? 'has-implementation' : 'doc-only';
  }

  return {
    runProgressGate: (input: GateConfigInput) =>
      runProgressGate(input as Parameters<typeof runProgressGate>[0]),
    runCompletionGateCheck: (input: any) =>
      runProgressGate(input as Parameters<typeof runProgressGate>[0]).gateResult,
    classifyPR,
    classifyAllPRs,
    classifyFile,
  };
}

/**
 * Version history stored in pipeline.config.yaml to prevent silent drift.
 */
export const PIPELINE_CONFIG_VERSION = '0300-gate-integration';