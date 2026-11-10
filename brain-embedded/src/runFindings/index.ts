/**
 * Run findings (PRD 46): the `./runFindings` entry of `@seanhogg/builderforce-brain-embedded`. Pure and React-free,
 * so the VS Code extension host runs it over a chat's journal (`traceWithPersistedSteps` → `detectRunFindings`).
 */
export { detectRunFindings, compareFindings, type RunIdentity } from './detectRunFindings';
export { buildRunView } from './runView';
export { RUN_FINDING_REGISTRY } from './registry';
export { RUN_FINDING_POLICY } from './policy';
export { traceWithPersistedSteps } from '../persistedSteps';
export type {
  RunFinding,
  RunFindingEvidence,
  RunFindingEvidenceNote,
  RunFindingKind,
  RunFindingSeverity,
  RunFindingsFile,
  RunFindingsReport,
  RunFindingsSummary,
  RunFindingsTurn,
  RunTurnKind,
  RunView,
} from './types';
