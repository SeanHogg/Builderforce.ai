/**
 * runStateTypes — the plain-JSON state a run carries across a step boundary (PRD 35 §3.2). The types that already
 * have a home are REUSED, never redefined: `RunPolicyState` (`@builderforce/run-policy`), `RunKnowledgeState`
 * (`@builderforce/agent-tools`), the progress detector's and read guard's state (`@builderforce/run-guards`), the
 * finish counters (`policy/finish`). The guard state is named here because it gathers several owners' shapes into
 * the one slice a step boundary carries.
 */
import type { RunKnowledgeState } from "@builderforce/agent-tools";
import type { CascadeState, RunPolicyState } from "@builderforce/run-policy";
import type { CoveredRead, ProgressDetectorState, ReadsWithoutSpawnState } from "@builderforce/run-guards";
import type { ContextPack } from "./contract.js";
import type { FinishGateState } from "./policy/finish/gates.js";
import type { TaskState } from "./policy/tools/taskState.js";
import type { RunTally } from "./telemetry/runTally.js";

/**
 * A3's progress detector, D1's cascade and D7's checks note — the guard state a run
 * carries across a step boundary.
 *
 * Mirrors the guard state the cloud's retired per-tick `LoopGuards` persisted, field for field: WS2d
 * ports that module into `policy/guards` and deletes the API copy, so this becomes the
 * only definition rather than a copy of one.
 */
export interface LoopGuardState {
  /** A3: the progress detector's tallies and trip count. */
  progress?: ProgressDetectorState;
  /** D1: the cascade's units, the first tick's action type, the seed's softness. */
  cascade?: CascadeSessionState;
  /** A3: a pause the next dispatched call parks the run on. */
  pendingPause?: string;
  /** D7: the sandbox checks' failures, for the NEXT turn's tail. */
  checksNote?: string;
  escalations?: number;            // A3 + D1: moves up the tier ladder this run — §8.2 escalations
}

/** What the cascade persists across durable ticks (`policy/guards` `CascadeSession`). */
export interface CascadeSessionState {
  /** The cascade's own state (`@builderforce/run-policy`). */
  cascade?: CascadeState;
  /** The task's action type, resolved on the first tick (later ticks only have `other`). */
  actionType?: string;
  /** Whether this run's seed is soft (the cascade may move it). */
  soft?: boolean;
  /** The steer the next turn shows, until that turn ends. */
  steer?: string;
  /** The tenant's prior weak pass rate, read once on the first tick. */
  priorWeakPassRate?: number;
  /** Whether that read happened (a cold tenant has no rate, and must not re-ask). */
  priorRead?: boolean;
}

/**
 * What compaction carried out. WS1 names the type (there is no home for it today);
 * WS2a owns its behaviour in `policy/compaction`.
 */
export interface CompactionState {
  /** How many times the transcript has been compacted this run. */
  compactions: number;
  /** The step the last compaction happened at. */
  lastCompactedStep?: number;
  /** The tokens reserved for the answer when compacting. */
  reserveTokens?: number;
  /** How many messages the last compaction dropped. */
  droppedMessages?: number;
}

/**
 * The windows the model was SERVED, plus the read-without-spawn count.
 *
 * The served windows reuse `@builderforce/run-guards`' `CoveredRead` — the read guard
 * already owns what "the model has seen these lines" means — and the delegation
 * counter reuses its `ReadsWithoutSpawnState`. WS2f owns the behaviour in `policy/tools`.
 */
export interface ReadCoverageState {
  /** The windows served this run, by the read's canonical key. */
  served: Record<string, CoveredRead>;
  /** Read calls made while no spawn had been attempted — the delegation nudge's counter. */
  readsWithoutSpawn: ReadsWithoutSpawnState;
  stubCount?: number;  // reads answered from coverage (a stub or a replay), never dispatched — §8.2 coveredReadStubs
}

/**
 * The stall policy's re-prompt budget — the count the cloud loop kept on its durable
 * model state (`CloudRunModelState.stallRecoveries`), keyed by the model it was spent
 * against so a model change starts the new one with a full budget. WS2b owns it.
 */
export interface StallState {
  /** The model the re-prompts below were spent against. */
  model?: string;
  /** Re-prompts already spent against `model`. */
  recoveriesUsed: number;
  recoveriesTotal?: number;  // every re-prompt this run spent, never reset — §8.2 stallRecoveries
}

/** Plain JSON. Everything any policy needs across a step boundary. */
export interface RunState {
  messages: unknown[]; step: number;
  guards: LoopGuardState;          // progress, cascade, pendingPause, checksNote — WS1 names this type; the guards (`policy/guards`) snapshot into it
  finish: FinishGateState;         // placeholder / CI-pending / no-deliverable counters, signoff recorded — reuse cloudAgent/finishGates.ts:55, do not redefine
  model: RunPolicyState;           // @builderforce/run-policy — pins, tried/broken/proven models, failovers, turnRetries
  memory: RunKnowledgeState;       // working memory + tool tally — reuse @builderforce/agent-tools run-knowledge.ts:96, do not redefine
  compaction: CompactionState;
  writtenPaths: string[];
  askedGates: string[];
  reads: ReadCoverageState;        // the windows the model was SERVED (post-trim), plus the read-without-spawn count
  context?: ContextPack;           // the pack built once before turn 1 (§6.10); a resumed tick renders the same turn-context tail from it
  stall?: StallState;              // WS2b: the re-prompt budget, keyed by model
  preflight?: string;              // WS2g: the model preflight's verdict — ok | refreshed | degraded:<reason> (§8.2 modelPreflight)
  downgrades?: string[];           // WS2g: auto-routed models already reported by llm.model_downgrade (once per served model)
  telemetry?: RunTally;            // WS6: the per-run counters the §8.2 row reads, summed across ticks
  taskState?: TaskState;           // WS2f (C3): the agent's structured task state — kept outside the transcript so compaction cannot summarise it away
  forceToolChoice?: "required";    // WS2b: a stall recovery's one-shot tool_choice for the NEXT request
  approvedCalls?: string[];        // WS2c: the `require-approval` calls a person APPROVED (one policyGateCallKey each)
  parkedCalls?: Record<string, string>; // WS2c: the `require-approval` calls the run parked on, by policyGateCallKey → the approval awaiting a decision
  advertisedSignature?: string;    // WS2f: the advertised tool set last reported on the timeline, so it is reported only when it CHANGES
  loadedTools?: string[];          // WS2f: tools a `tool_search` loaded beyond the role core set — they stay advertised for the rest of the run
}
