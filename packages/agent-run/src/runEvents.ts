/**
 * runEvents — the typed trace of a run (PRD 35 §3.2). The trace is what every adapter must match: the same scripted
 * task gives the same events on every surface, whether it runs continuously or one step per tick.
 */
import type { ModelUsage, RunOutcomeKind } from "./contract.js";
import type { StallAction } from "./policy/hooks.js";

/** One event of the run's trace. The trace is what every adapter must match. */
export type RunEvent =
  | { kind: 'run.started'; step: number }
  | { kind: 'turn.started'; step: number }
  | { kind: 'model.completed'; step: number; model?: string; usage?: ModelUsage }
  | { kind: 'tool.dispatched'; step: number; tool: string; ok: boolean; callId?: string; args?: Record<string, unknown>; result?: unknown }  // callId / args / result: what a run timeline records beside the verdict (additive)
  | { kind: 'steer.applied'; step: number }          // one per steered message, before the turn it reaches (§6.3)
  | { kind: 'model.preflight'; step: number; status: 'ok' | 'refreshed' | 'degraded'; notices: string[] }  // once, before turn 1 (§6.10)
  | { kind: 'llm.model_downgrade'; step: number; requestedModel: string; model: string; reason: string }  // a turn answered by another model than expected (E7)
  | { kind: 'model.cascade'; step: number; from: string | null; status: number | null; released: boolean }  // the model policy routed a failed turn onto the cascade
  | { kind: 'stall.recovered'; step: number; action: StallAction; note?: string; detail?: Record<string, unknown> }  // a turn that ended without acting was sent back, handed to another model, stopped, or settled/failed by the ladder
  | { kind: 'policy.blocked'; step: number; tool: string; gateId: string; reason: string }  // a governance gate refused a call
  | { kind: 'finish.blocked'; step: number; reason: string; block: string; detail?: Record<string, unknown> }                  // a prose end was refused (the owed sign-off)
  | { kind: 'loop.repetition'; step: number; copies: number; block: string }  // the kernel cut a looped turn back to its first copy
  | { kind: 'context.tools'; step: number; advertised: number; catalog: number; toolsTokens: number; loaded: string[] }  // the advertised tool set and what its schemas cost, whenever it changes
  | { kind: 'context.compacted'; step: number; dropped: number; beforeTokens?: number; afterTokens?: number; summarized?: boolean; masked?: number; note?: string; covered?: number }  // note: the memory note that stands for the dropped middle; covered: how many rows, counted from the first non-system row of the transcript before the fold, it stands for (a surface making the fold durable keeps from there)
  | { kind: 'model.coder_reask'; step: number; model?: string }  // the analysis model's first code change was re-asked of the coding model (the model that planned it, when the gateway named it)
  | { kind: 'budget.warning'; step: number; spentMc: number; capMc: number; unpricedCalls: number; text: string }  // the run passed 80% of its USD cap: text is what the model reads
  | { kind: 'budget.contained'; step: number; spentMc: number; capMc: number; unpricedCalls: number; text: string }  // the run reached its USD cap and stopped with this answer
  | { kind: 'budget.unpriced'; step: number; model?: string }  // a turn had no known price (said once per run)
  | { kind: 'loop.no_progress'; step: number; streak: number; forced: string }  // the run circled its own read cache: this turn is forced
  | { kind: 'turn.finished'; step: number }
  | { kind: 'run.finished'; step: number; outcome: RunOutcomeKind };
