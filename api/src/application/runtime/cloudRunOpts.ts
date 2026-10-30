/**
 * cloudRunOpts — what a caller hands the cloud run (`CloudLoopOpts`) and what it gets back
 * (`CloudLoopResult`). Moved verbatim out of `cloudAgentEngine.ts` (PRD 35 WS3); the
 * resume state is now `cloudRunState.CloudLoopState`, the one agent's `RunState` plus the
 * host facts a durable tick reuses.
 */
import type { CloudLoopState } from './cloudRunState';
import type { RunTally } from '@builderforce/agent-run';
import type { ArcStage } from '@builderforce/workload';
import type { RunSandbox } from './sandbox/runSandbox';
import { type CapabilityProvider, type PolicyGate, type AgentExecParams } from '@builderforce/agent-tools';
import { type CloudRunDelegation } from './cloudRunDelegation';

export interface CloudLoopOpts {
  /** Resume from this persisted state instead of starting fresh. */
  resume?: CloudLoopState;
  /** Max iterations to run THIS call (the DO passes 1 — one LLM step per tick). */
  maxSteps?: number;
  /** Skip the PR/merge finalize unless the run is actually finished — so the DO
   *  doesn't ship a half-done run between ticks. */
  deferFinalize?: boolean;
  /** Learned Model Routing (PRD 13 §6.6): a client-computed SSM recall nudge
   *  (model → weight) from an INTERACTIVE launch. Absent on headless/autonomous
   *  runs (board lane auto-run, scheduled, CI-fix). Merged as a nudge over the KV
   *  routing table on the first tick. */
  routingBias?: Record<string, number>;
  /** The launching canvas session's arc stage (idea/make/run/measure/reach), when
   *  known — an ephemeral per-run nudge on the role objective, never a durable
   *  fact (see `modelRoles.ts`). Absent for a headless/non-canvas launch. */
  arcStage?: ArcStage;
  /** Brain chat that launched this run. Enables exactly one scoped write-back tool. */
  originatingChatId?: number;
  /** Exact accountability slot a reviewer run must sign before it may finish. */
  requiredSignoff?: { roleKey: string; laneKey?: string };
  /**
   * Per-step dynamic system directive injected into THIS turn's LLM request only
   * — never persisted into the conversation state the loop owns. The decoupling
   * seam (Open/Closed + Dependency-Inversion) that lets any engine version layer
   * behaviour on the V2 loop without the loop knowing about it: the V3 limbic
   * engine recomputes its affective block from evolving state each tick and
   * passes it here, so affect can change across DO ticks even though the loop
   * resumes from saved messages. V2 passes nothing → request === saved messages
   * (byte-identical behaviour). Recomputed by the caller each tick, so it is
   * serialization-safe (a string, not a closure, survives DO cursor persistence).
   */
  dynamicSystem?: string;
  /** Compiled governance gates to enforce at the tool seam (compile-primitive policy
   *  modality). The first tick seeds {@link CloudLoopState.policyGates} from this;
   *  later ticks resume from state. */
  policyGates?: PolicyGate[];
  /** Execution levers compiled from the agent's/personas' psychometric personality
   *  (from {@link prepareCloudRun}). `temperature` applies on every turn; the reasoning
   *  levers (thinkLevel/reasoningLevel) are mapped to the correct vendor param for the
   *  pinned model by {@link reasoningParamsForModel} (Anthropic `thinking` / OpenAI
   *  `reasoning_effort`) and attached on a strict pin. Applied to every LLM turn so
   *  personality changes how the agent reasons and samples, not just its prompt. */
  execParams?: AgentExecParams;
  /** Caller-configured SAMPLING params for this run — a published tenant model's
   *  stored `temperature`/`top_p`, or an explicit Run-now override. Distinct from
   *  `execParams` (personality) and OUTRANKS it: an operator who set a temperature on
   *  the model meant that number. The gateway route already applied these; without
   *  them here the same tenant model sampled differently depending on whether it was
   *  called over HTTP or dispatched as an agent run. See `AgentRunInput.genParams`. */
  genParams?: { temperature?: number; topP?: number; maxTokens?: number };
  /**
   * REHEARSAL seam (Open/Closed + Dependency Inversion). The loop builds its surface
   * provider and then hands it here for the caller to wrap. Rehearsal supplies a shadow
   * decorator (application/rehearsal/shadowProvider.ts) that passes every READ straight
   * through and RECORDS every effect instead of performing it — so a dry-run/replay is
   * the real loop, the real registry and the real prompts, with nothing escaping.
   *
   * Absent on a live run, in which case the provider is used exactly as built and
   * behaviour is byte-identical. Deliberately NOT part of {@link CloudLoopState}: a
   * function cannot survive DO cursor persistence, so a rehearsal runs in one call
   * (`maxSteps`) rather than across alarm ticks.
   */
  decorateProvider?: (provider: CapabilityProvider) => CapabilityProvider;
  /**
   * Pin repo READS to this git ref instead of the base/branch the run would compute.
   * Replay uses it to re-run against the tree the original execution actually saw, so a
   * comparison measures the agent change rather than a moved main.
   */
  frozenReadRef?: string;
  /**
   * Skip the terminal {@link finalizeCloudRun} entirely. Set ONLY by rehearsal: the
   * shadow provider already guarantees `writtenPaths` stays empty (so no PR could
   * open), but finalize also releases steers, writes run summaries and touches the
   * ticket — none of which a rehearsal is entitled to do. Cheaper and far clearer than
   * relying on every branch inside finalize to no-op.
   */
  suppressFinalize?: boolean;
  /** Its place in a delegation tree (durable surface only) — see {@link CloudRunDelegation}. */
  delegation?: CloudRunDelegation;
  /** The run's sandbox (`sandbox/runSandbox.ts`): a shell and a working tree. Absent ⇒ the
   *  git-API tools only, and no `shell` capability. A function holder, so like
   *  `decorateProvider` it is handed in per tick and never persisted. */
  sandbox?: RunSandbox;
}
export interface CloudLoopResult {
  ok: boolean;
  output: string;
  cancelled: boolean;
  /** True when the run reached a terminal point (finished / step cap / error /
   *  cancel) — i.e. the finalize ran (or was skipped because cancelled). When
   *  false, `state` carries the resume point for the next tick. */
  finished: boolean;
  state?: CloudLoopState;
  /** Set when the agent called `ask_human`: the run is PAUSED on a human question
   *  (NOT finished — no PR, not terminal). `state` carries the resume point so the
   *  surface persists it and wakes the loop once the question is answered. */
  awaitingInput?: { approvalId: string; question: string };
  /** A TERMINAL result carries the run's final tally (`RunState.telemetry`): the terminal transition hands it to the one outcome-row writer. Absent otherwise. */
  telemetry?: RunTally;
}
