/**
 * Run findings (PRD 46 §3.1/§3.3): what a recorded agent run did wrong, named deterministically from its trace.
 *
 * The report types are structurally identical to the knowledge-graph-view port contract (`AgentRunReport` in
 * `packages/knowledge-graph-view/src/types.ts`): the view never imports brain-embedded, and the VS Code adapter is
 * where the two meet and the compiler proves they match. Keep the field names in step with that contract.
 */
import type { BrainTraceEvent } from '../brainTriage';
import type { BrainMessage } from '../types';
import type { RoutingByRole } from '../routingByRole';
import type { StaffingSummary } from '../staffingSummary';

export type RunFindingSeverity = 'info' | 'warn' | 'error';

export interface RunFindingsSummary {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  models: readonly string[];
  turns: number;
  counts: Readonly<Record<RunFindingSeverity, number>>;
}

export type RunTurnKind = 'read' | 'write' | 'forced' | 'text' | 'failed';

export interface RunFindingsTurn {
  index: number;
  role: string;
  model: string;
  kind: RunTurnKind;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

/** A note a host renders in its own words on an evidence row (`agentRuns.evidenceNotes[note]`, holes = `params`). */
export type RunFindingEvidenceNote = 'argBytes' | 'argBytesShared' | 'slowTurn';

export interface RunFindingEvidence {
  step: number;
  turn?: number;
  label: string;
  path?: string;
  /** Text the run itself carried (a message, a title, an edit's new text) — never words of ours. */
  excerpt?: string;
  /** What this row measured, rendered by the host from its labels with {@link RunFindingEvidence.params}. */
  note?: RunFindingEvidenceNote;
  /** The note's numbers. */
  params?: Readonly<Record<string, number>>;
}

export interface RunFinding {
  id: string;
  kind: RunFindingKind;
  severity: RunFindingSeverity;
  params: Readonly<Record<string, string | number>>;
  evidence: readonly RunFindingEvidence[];
}

export interface RunFindingsFile {
  path: string;
  writes: number;
  checked: boolean;
}

export interface RunFindingsReport {
  summary: RunFindingsSummary;
  turns: readonly RunFindingsTurn[];
  findings: readonly RunFinding[];
  files: readonly RunFindingsFile[];
}

/** Every kind a detector can name (PRD 46 §3.1). */
export type RunFindingKind =
  | 'analysis_overrun'
  | 'unkept_readiness'
  | 'serial_single_writes'
  | 'prompt_bloat'
  | 'unverified_writes'
  | 'bracket_break'
  | 'edit_churn'
  | 'filed_then_inline'
  | 'same_model_roles'
  | 'oversized_args'
  | 'slow_turns'
  | 'repeated_narration'
  | 'stopped_unverified';

/** One tool step of the run, read once. `step` is its 1-based position in the merged trace. */
export interface ViewCall {
  step: number;
  /** The turn whose tool steps it followed; 0 for a step before the first turn. */
  turn: number;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** Bytes of its arguments as recorded (JSON, UTF-8). */
  argBytes: number;
  /** A code change that ran and succeeded (not refused, failed or answered from the read cache). */
  write: boolean;
  /** A successful typecheck / test / diagnostics / lint call. */
  check: boolean;
  /** The workspace paths a write changed. */
  paths: readonly string[];
}

/** One model turn: an `llm.complete` and the tool steps that followed it. */
export interface ViewTurn {
  index: number;
  step: number;
  role: string;
  model: string;
  kind: RunTurnKind;
  /** Structured calls the model emitted (the turn's own count). */
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  /** Bytes of tool-call arguments the turn emitted. */
  argBytes: number;
  /** The analysis budget forced this turn's hand-off (`loop.hand_off_due` before it). */
  forced: boolean;
  /** The turn's visible text (`agent.message`), empty when it wrote none. */
  text: string;
  /** The tool steps that followed it. */
  calls: readonly ViewCall[];
  /** The `via` of an explicit hand-off recorded on this turn (`llm.role_handoff`). */
  handOffVia?: string;
}

/** The run, read once from its merged trace; every detector reads this and nothing else. */
export interface RunView {
  events: readonly BrainTraceEvent[];
  messages: readonly BrainMessage[];
  turns: readonly ViewTurn[];
  calls: readonly ViewCall[];
  /** The user's Stop, when it is the run's last act (no turn completed after it). */
  stopped: { step: number; model?: string } | null;
  routing: RoutingByRole;
  staffing: StaffingSummary;
}

export type RunFindingDetector = (view: RunView) => RunFinding[];
