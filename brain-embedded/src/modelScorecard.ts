/**
 * Which model did what: the per-model half of the Brain diagnostics.
 *
 * An auto-routed run is served by more than one model (the planner, the coder, a
 * failover after a stall), and the report used to name them only as a set:
 * "Models used: qwen3.8-max, grok-4.5". A run where one of them never made a single
 * tool call read exactly like a run where both worked, so "why isn't Grok working"
 * could not be answered from a copied report at all. This scores each model on the
 * turns it actually served, from the `llm` steps the run loop records.
 *
 * Pure over the recorded trace, like `brainTriage.ts` and `runProgress.ts`, so every
 * copy surface renders the identical lines.
 */
import type { BrainTraceEvent } from './brainTriage';
import { STOPPED_TURN_STEP } from './stoppedTurn';

/** What one model did across the turns it served. */
export interface ModelScore {
  model: string;
  /** Completions this model answered. */
  turns: number;
  /** Structured tool calls it emitted across them. */
  toolCalls: number;
  /** Turns that produced text and no tool call: a final answer, or a narrated step. */
  textOnlyTurns: number;
  /**
   * Turns whose text still held tool-call markup that no inline dialect lifted. The
   * model tried to call a tool and the parser missed it, so the call never ran.
   */
  unliftedMarkupTurns: number;
  /** Completions against this model that failed outright. */
  failures: number;
  /**
   * Turns the USER stopped while this model was streaming — the reader's own verdict
   * that it had gone wrong (looping, narrating, counting). The one failure the model
   * never reports itself, so without this a run ended by Stop named no culprit at all.
   */
  stopped: number;
  /**
   * Turns whose vendor reported its RAW response (`upstreamFunctionCalls` recorded) —
   * the Responses vendors (Grok, Codex) do. Zero means the fields below say nothing.
   */
  upstreamReportedTurns: number;
  /** Structured function calls those raw responses carried, before any translation. */
  upstreamFunctionCalls: number;
  /** Of those, calls the gateway rebuilt from the final frame rather than the stream. */
  upstreamRecovered: number;
  /** Reported turns where the vendor returned MORE calls than reached the loop. */
  adapterLossTurns: number;
}

/** A model silent for at least this many turns, while another model in the same run
 *  called tools, is flagged as not emitting calls on its route. */
const SILENT_TURNS_AT = 3;

function modelOf(ev: BrainTraceEvent): string | null {
  const m = (ev.args as { model?: unknown } | undefined)?.model;
  return typeof m === 'string' && m && m !== 'default' ? m : null;
}

/** Score every model that served (or failed) a turn, first-seen order. */
export function modelScorecard(events: BrainTraceEvent[]): ModelScore[] {
  const byModel = new Map<string, ModelScore>();
  const row = (model: string): ModelScore => {
    let score = byModel.get(model);
    if (!score) {
      score = {
        model, turns: 0, toolCalls: 0, textOnlyTurns: 0, unliftedMarkupTurns: 0, failures: 0, stopped: 0,
        upstreamReportedTurns: 0, upstreamFunctionCalls: 0, upstreamRecovered: 0, adapterLossTurns: 0,
      };
      byModel.set(model, score);
    }
    return score;
  };
  for (const ev of events) {
    if (ev.label === STOPPED_TURN_STEP) {
      const model = modelOf(ev);
      if (model) row(model).stopped += 1;
      continue;
    }
    if (ev.label !== 'llm.complete') continue;
    const model = modelOf(ev);
    if (!model) continue;
    if (ev.category === 'error') {
      row(model).failures += 1;
      continue;
    }
    if (ev.category !== 'llm') continue;
    const score = row(model);
    const args = ev.args as {
      toolCalls?: unknown; unliftedCallMarkup?: unknown; upstreamFunctionCalls?: unknown; upstreamRecovered?: unknown;
    } | undefined;
    const calls = typeof args?.toolCalls === 'number' ? args.toolCalls : 0;
    score.turns += 1;
    score.toolCalls += calls;
    if (calls === 0 && (ev.textChars ?? 0) > 0) score.textOnlyTurns += 1;
    if (args?.unliftedCallMarkup === true) score.unliftedMarkupTurns += 1;
    if (typeof args?.upstreamFunctionCalls === 'number') {
      score.upstreamReportedTurns += 1;
      score.upstreamFunctionCalls += args.upstreamFunctionCalls;
      if (typeof args.upstreamRecovered === 'number') score.upstreamRecovered += args.upstreamRecovered;
      if (args.upstreamFunctionCalls > calls) score.adapterLossTurns += 1;
    }
  }
  return [...byModel.values()];
}

/**
 * The flag for a model that called nothing while another model in the run did. When
 * its vendor reported the raw response, the flag says WHICH of the two opposite causes
 * it is — the model never emitted a structured call, or one was lost in translation —
 * instead of leaving the reader to guess between the model and the adapter.
 */
function silentModelFlag(s: ModelScore): string {
  const base = ' · ⚠ made NO tool calls while another model in this run did';
  if (s.upstreamReportedTurns > 0 && s.upstreamFunctionCalls === 0) {
    return `${base}. Its raw responses carried 0 structured function calls on the ${s.upstreamReportedTurns} turn(s) its vendor reported, so the MODEL did not call — nothing was lost on the way.`;
  }
  return `${base}: this model is not emitting structured calls on its route.`;
}

/**
 * Render the scorecard as report lines. Emitted when it says something the "Models
 * used" line does not: more than one model served the run, some turn wrote call
 * markup the parser missed, a returned call never reached the loop, or the user
 * stopped a model mid-stream.
 */
export function formatModelScorecard(scores: ModelScore[]): string[] {
  const markup = scores.some((s) => s.unliftedMarkupTurns > 0);
  const stopped = scores.some((s) => s.stopped > 0);
  const lost = scores.some((s) => s.adapterLossTurns > 0);
  if (scores.length < 2 && !markup && !stopped && !lost) return [];
  const anyActed = scores.some((s) => s.toolCalls > 0);
  const lines = ['Per model:'];
  for (const s of scores) {
    const parts = [`${s.turns} turn(s)`, `${s.toolCalls} tool call(s)`];
    if (s.textOnlyTurns) parts.push(`${s.textOnlyTurns} text-only`);
    if (s.upstreamReportedTurns) {
      parts.push(`raw response: ${s.upstreamFunctionCalls} structured call(s) over ${s.upstreamReportedTurns} reported turn(s)`);
    }
    if (s.upstreamRecovered) parts.push(`${s.upstreamRecovered} rebuilt from the final frame`);
    if (s.failures) parts.push(`${s.failures} failed`);
    if (s.stopped) parts.push(`${s.stopped} stopped by the user mid-stream`);
    const flag = s.unliftedMarkupTurns
      ? ` · ⚠ ${s.unliftedMarkupTurns} turn(s) wrote a tool call as MARKUP that no parser lifted, so the call never ran. The model tried to act; this is a parser gap, not a refusal.`
      : s.adapterLossTurns
        ? ` · ⚠ on ${s.adapterLossTurns} turn(s) the vendor returned structured tool calls that never reached the loop: the calls were lost in translation, so this is an adapter defect, not the model.`
        : scores.length > 1 && anyActed && s.toolCalls === 0 && s.turns >= SILENT_TURNS_AT
          ? silentModelFlag(s)
          : '';
    lines.push(`  • ${s.model}: ${parts.join(' · ')}${flag}`);
  }
  return lines;
}
