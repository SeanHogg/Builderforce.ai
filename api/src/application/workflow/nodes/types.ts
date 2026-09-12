/**
 * The contract every cloud workflow node handler implements.
 *
 * `executeCloudNode` (../cloudExecutor.ts) no longer switches over ~40 kinds: it
 * looks the kind up in `NODE_HANDLERS`, which is merged from one table per node
 * family — `transform.ts`, `control.ts`, `ai.ts`, `io.ts`. Adding a kind is a new
 * entry in the family table it belongs to; nothing else changes.
 */
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';

export interface NodeInput {
  kind: string;
  config: Record<string, unknown>;
  payload?: unknown;
  triggerSource?: string;
  /** `merge` only — the raw output of each dependency, in `dependsOn` order
   *  (NOT the newline-joined `inputText` every other kind reads). Populated by
   *  `advanceCloudWorkflow`, never persisted on the task's own stored input. */
  depOutputs?: string[];
  /**
   * Dependency task id → the outlet label its edge carries (0 or more entries).
   *
   * Written by `instantiateRun` from the definition's labeled edges. A dependency
   * listed here is CONDITIONAL: this task runs only if that upstream node took
   * this outlet. Absent = unconditional, which is every edge authored before
   * labels existed, so nothing that already runs changes behaviour.
   */
  depLabels?: Record<string, string>;
}

/** Tenant + run context a node needs to touch state beyond its own payload —
 *  the LLM usage ledger, and the run/definition-scoped variable store. */
export interface UsageContext {
  db: Db;
  tenantId: number;
  /** This execution's `workflows.id` — the scope for `set-variable`/`get-variable`. */
  workflowId: string;
  /** The source `workflow_definitions.id`, when this run came from one — the
   *  cross-run scope for `increment`. Falls back to `workflowId` for ad-hoc runs. */
  workflowDefinitionId: string | null;
}

/** The outcome of running one cloud node. `drop` (filter only) means the node's
 *  predicate rejected the payload, so this path should be pruned downstream. */
export interface NodeResult {
  output: string;
  drop?: boolean;
}

/**
 * A stand-in for the node kinds that leave this workspace (or spend real
 * tokens). Every method is OPTIONAL — a port that only stubs `gmail` leaves
 * `connector`/`mcp`/`llm` to run for real, which is never how this is actually
 * used today (the sandbox dry-run stubs all of them) but keeps the seam honest
 * about being per-kind rather than all-or-nothing.
 *
 * Consulted BEFORE the real path's own preconditions (a stubbed `gmail` node
 * needs no `usageCtx`, no connected account, nothing) — that is what makes a
 * dry-run runnable with no tenant context at all.
 */
export interface OutboundPort {
  gmail?(config: Record<string, unknown>, inputText: string): Promise<string>;
  connector?(config: Record<string, unknown>, inputText: string): Promise<string>;
  mcp?(config: Record<string, unknown>, inputText: string): Promise<string>;
  llm?(config: Record<string, unknown>, inputText: string): Promise<string>;
  webSearch?(config: Record<string, unknown>, inputText: string): Promise<string>;
  webFetch?(config: Record<string, unknown>, inputText: string): Promise<string>;
  googleDrive?(config: Record<string, unknown>, inputText: string): Promise<string>;
  transcribeAudio?(config: Record<string, unknown>, inputText: string): Promise<string>;
}

/** Everything one node execution may read. */
export interface NodeArgs {
  env: Env;
  node: NodeInput;
  /** The dependencies' outputs, newline-joined. */
  inputText: string;
  /** Tenant/run context; absent for a tenant-less preview or dry-run. */
  usageCtx?: UsageContext;
  /** Per-kind stand-ins for outbound nodes — see {@link OutboundPort}. */
  outbound?: OutboundPort;
}

/** Run one node; return its output (and a drop flag) or throw on failure. */
export type NodeHandler = (args: NodeArgs) => NodeResult | Promise<NodeResult>;

/** One node family's kinds → handlers. */
export type NodeHandlerTable = Readonly<Record<string, NodeHandler>>;
