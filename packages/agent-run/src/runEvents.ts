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
  | { kind: 'context.compacted'; step: number; dropped: number; beforeTokens?: number; afterTokens?: number; summarized?: boolean; masked?: number }
  | { kind: 'turn.finished'; step: number }
  | { kind: 'run.finished'; step: number; outcome: RunOutcomeKind };
