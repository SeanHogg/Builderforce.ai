/**
 * The deterministic-first PreFetch contract (docs/design/deterministic-prefetch.md).
 *
 * Actions are REGISTRY DATA. A host supplies one executor per action id; the gate never
 * runs a tool itself. A new tool is a registry row plus an executor, never a gate branch.
 */

export type PrefetchKind = 'answer' | 'prefetch';
/** write ⇒ always a confirm chip, never auto-run, whatever p is. */
export type SideEffect = 'read' | 'write';
export type PrefetchSurface = 'vscode' | 'onprem' | 'cloud' | 'web';
export type GateTier = 1 | 2 | 3;
export type GateRoute = 'answer' | 'prefetch' | 'llm';

export interface PrefetchAction {
  /** 'symbols.where-defined', 'dup.check', 'knowledge.review-dir', … */
  id: string;
  kind: PrefetchKind;
  sideEffect: SideEffect;
  surfaces: PrefetchSurface[];
  /** Explicit composer slash action (tier 1), e.g. '/dup'. */
  slash?: string;
  /** Rule match (tier 1). */
  patterns?: RegExp[];
  /** Phrasings for tiers 2–3. */
  examples: string[];
  /** Hard executor deadline (withinMs). */
  budgetMs: number;
  /** Tool detection: the action is offered only when the host reports the tool present. */
  requires?: { tool: string };
  /** i18n key for the confirm chip / trace label. */
  labelKey: string;
}

export interface GateCandidate {
  id: string;
  p: number;
  tier: GateTier;
  /** The tier-2 lexical features the head scored — what an outcome trains the head on. */
  features: number[];
}

export interface GateDecision {
  route: GateRoute;
  actions: GateCandidate[];
  pNeedsLlm: number;
  /** Tiers actually consulted, for the trace. */
  tiersRun: GateTier[];
  elapsedMs: number;
}

/** Per-action logistic head state (same family as difficulty-router/head.ts). */
export interface ActionHead {
  weights: number[];
  bias: number;
  n: number;
}

/** Per-action calibrated thresholds; cold start is conservative (answer 0.9). */
export interface ActionThreshold {
  answer: number;
  prefetch: number;
  n: number;
}

/** One logged outcome a threshold is recalibrated from: `[p, accepted ? 1 : 0, route]`. */
export type LoggedOutcome = [p: number, accepted: 0 | 1, route: 'answer' | 'prefetch'];

export interface CalibrationState {
  heads: Record<string, ActionHead>;
  thresholds: Record<string, ActionThreshold>;
  /** The newest outcomes per action (bounded), which `recalibrate` derives thresholds from. */
  outcomes?: Record<string, LoggedOutcome[]>;
}

/** Outcome written back after a decision: accepted, or the user re-asked the LLM. */
export interface GateOutcome {
  actionId: string;
  route: GateRoute;
  p: number;
  tier: GateTier;
  accepted: boolean;
  features: number[];
}

/** Local-SLM logprob classifier (tier 3) — Synapse/bfi-node → WebLLM → Ollama last. */
export interface LogprobPort {
  /** True only when a local engine is warm; tier 3 is skipped otherwise. */
  warm(): boolean;
  /** One forward pass; returns log-probabilities per label (labels = action ids + 'needs-llm'). */
  logprobs(prompt: string, labels: string[], signal?: AbortSignal): Promise<Record<string, number>>;
}

export interface GatePorts {
  /** Tools present in this workspace (memoised per workspace by the host). */
  tools?: ReadonlySet<string>;
  surface: PrefetchSurface;
  calibration?: CalibrationState;
  logprob?: LogprobPort;
  signal?: AbortSignal;
  /** Total gate budget; tier 3 is skipped if the remainder is below its cost. Default 300 ms. */
  budgetMs?: number;
}

export interface PrefetchResult {
  actionId: string;
  /** ANSWER: the settled reply (markdown). PREFETCH: context for host.turnContext (volatile tail). */
  text: string;
  /** Optional chips rendered under the answer (e.g. Open in graph). */
  chips?: Array<{ labelKey: string; command: string; args?: Record<string, unknown> }>;
  /** Extra trace fields (counts, digests). */
  data?: Record<string, unknown>;
  /**
   * ANSWER actions only: how sure the executor's OWN evidence is (0–1) — e.g. the
   * knowledge index's top hit. Absent ⇒ the result is an answer whenever it is adopted.
   * Present and below the action's learned answer threshold (`thresholdOf(...).answer`)
   * ⇒ the GATE does not settle on it: {@link context} (else `text`) rides into the turn
   * as PREFETCH context instead.
   */
  confidence?: number;
  /** What rides into the turn when the gate demotes this answer to PREFETCH; default `text`. */
  context?: string;
}

export interface PrefetchExecutor {
  run(request: string, signal: AbortSignal): Promise<PrefetchResult | undefined>;
  /**
   * WRITE actions: what running it would touch, in one line, read BEFORE the person is
   * asked — the confirm chip's detail (`knowledge.review-dir`: files by pack, unchanged
   * files, ≈ model calls). Read-only; undefined ⇒ the chip shows the request alone.
   */
  preview?(request: string, signal: AbortSignal): Promise<string | undefined>;
}

export type PrefetchExecutors = Readonly<Record<string, PrefetchExecutor>>;

/** What brain-embedded receives from a host (`BrainRunRequest.prefetch`): the registry, its executors and the gate ports. */
export interface PrefetchPort {
  registry: readonly PrefetchAction[];
  executors: PrefetchExecutors;
  ports: Omit<GatePorts, 'signal'>;
  /**
   * Brings `ports` up to date before the gate reads them — e.g. the workspace's tool
   * detection, memoised by the host, finished the first time. Bounded by the gate
   * (`PREPARE_BUDGET_MS`); a late or failed prepare leaves the ports as they are.
   */
  prepare?(signal?: AbortSignal): Promise<void>;
  /**
   * Write actions: OVERRIDE how the person is asked. Absent ⇒ the run's own confirm
   * channel (the composer's confirm chip — brain-embedded's `prefetchGate.ts`); resolves
   * true only when the person confirms. `detail` is the executor's `preview`, when it has one.
   */
  confirm?(action: PrefetchAction, request: string, detail?: string): Promise<boolean>;
  /** Outcome write-back (head update + persistence of calibration). */
  record?(outcome: GateOutcome): void;
}
