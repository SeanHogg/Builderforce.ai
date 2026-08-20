/**
 * The run-context CONTRACT — one definition of the context blocks a run can receive.
 *
 * Before this package the same question ("what does an agent run get told?") had three
 * different answers, one per surface:
 *
 *   • cloud   — `api/src/application/runtime/cloudAgentEngine.ts` → `prepareCloudRun`
 *   • on-prem — `agent-runtime/src/agents/embedded-runner/system-prompt.ts`
 *   • VS Code — `clients/vscode/src/prompt.ts`
 *
 * …and only the cloud one carried PRD / governance / project memory / lessons. This file
 * is the single taxonomy all three now assemble against. It is deliberately free of I/O,
 * node builtins, and dependencies: the api OWNS the data and serves an assembled
 * {@link RunContextEnvelope} over HTTP; every surface renders the SAME blocks.
 */

/**
 * What a block IS. The kind is the reconciliation subject-space and the render order
 * key — two blocks of the same kind about the same `sourceRef` are the SAME belief and
 * must supersede one another rather than accumulate.
 */
export type RunContextBlockKind =
  /** The headline ask this run exists to answer (role verdict, follow-up directive,
   *  build-failure remediation, review/incident mode). Always pinned. */
  | 'directive'
  /** Strategic intent: the objectives + key results this work advances. */
  | 'strategy'
  /** The Product Requirements Document for the ticket. */
  | 'prd'
  /** Architecture spec + project rules + per-agent rules the deliverable must honor. */
  | 'governance'
  /** The repository / workspace the run edits (identity + shape). */
  | 'workspace'
  /** Files a prior pass already committed to this task's branch. */
  | 'prior_changes'
  /** The ticket itself. Always pinned — it is the goal. */
  | 'task'
  /** Durable project facts (the shared write-through knowledge tier). */
  | 'memory'
  /** Evermind lessons — prior run outcomes and incident causes. */
  | 'lessons'
  /** Assigned Skills / Personas / Content loaded for this run. */
  | 'capabilities'
  /** Tool guidance and executor-specific workflow rules. */
  | 'tooling';

/** Where a rendered block belongs in the two-message prompt shape. */
export type RunContextChannel = 'system' | 'user';

/** Provenance tier, mirrored from `api/src/domain/trust/contentTrust.ts`. */
export type RunContextTrustTier = 'operator' | 'tenant' | 'repository' | 'external';

/** One addressable piece of what a run is told. */
export interface RunContextBlock {
  kind: RunContextBlockKind;
  /**
   * Stable subject identity WITHIN the envelope's scope — e.g. `prd:1204`,
   * `governance:project:8`. This is what the reconciler canonicalizes into an Evermind
   * subject key, so a re-assembled block collides with its incumbent and REPLACES it
   * instead of being concatenated as a second competing belief.
   */
  subject: string;
  /** Rendered markdown, ready to paste into a prompt. */
  body: string;
  /** Which half of the prompt this block belongs to. */
  channel: RunContextChannel;
  /** Ascending render order within its channel. */
  order: number;
  trustTier?: RunContextTrustTier;
  /** Human-readable origin (repo label, ticket id, spec id) for the trust notice. */
  sourceRef?: string;
  /**
   * A block the run must see on EVERY turn even when unchanged — the task and the
   * headline directive. The reconciler still commits it (so the incumbent stays
   * current) but never elides it from the delta.
   */
  pinned?: boolean;
}

/** The assembled context for one run, as served by the api and consumed by a surface. */
export interface RunContextEnvelope {
  /** Bumped when the block taxonomy or wire shape changes incompatibly. */
  contractVersion: number;
  /**
   * The continuity scope the delta is computed against — what "the run already knows".
   * Canonical forms: `task:<taskId>` (cloud, so a RE-RUN gets the delta), `session:<key>`
   * (on-prem embedded runner), `chat:<id>` (VS Code). Opaque to this package beyond
   * being stable across the turns/runs that share a memory.
   */
  scope: string;
  projectId: number;
  taskId?: number;
  /** ISO timestamp of assembly. */
  generatedAt: string;
  blocks: RunContextBlock[];
}

export const RUN_CONTEXT_CONTRACT_VERSION = 1;

/** Kind → section heading used when a surface renders blocks it did not author. */
export const RUN_CONTEXT_KIND_LABELS: Record<RunContextBlockKind, string> = {
  directive: 'Directive',
  strategy: 'Strategy',
  prd: 'PRD',
  governance: 'Governance',
  workspace: 'Workspace',
  prior_changes: 'Prior changes',
  task: 'Task',
  memory: 'Project memory',
  lessons: 'Lessons',
  capabilities: 'Capabilities',
  tooling: 'Tooling',
};

/** Sort blocks into their stable render order (channel-independent). */
export function sortBlocks(blocks: readonly RunContextBlock[]): RunContextBlock[] {
  return [...blocks].sort((a, b) => a.order - b.order || a.subject.localeCompare(b.subject));
}

/**
 * A block's canonical Evermind subject key. Scope-qualified so two projects (or two
 * sessions) never collide on one incumbent, and prefixed so run-context beliefs are
 * distinguishable from every other fact in the same store.
 */
export function contextSubjectKey(scope: string, block: Pick<RunContextBlock, 'kind' | 'subject'>): string {
  return `runctx:${scope}:${block.kind}:${block.subject}`;
}
