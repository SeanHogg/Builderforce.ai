/**
 * toolExposure — the per-turn "Tools advertised" measurement, extracted from
 * `chatDiagnostics.ts` (PRD 45 §4.7 B8: that file holds a hard 987-line budget and
 * must not grow). This module is the SINGLE place the trace's `advertisedTools` /
 * `catalogTools` fields are read back; the report renderer formats what it returns,
 * it never re-derives the number.
 *
 * Why this exists (chat #216): the diagnostics header used to print a ceiling derived
 * from the registry size ("up to N advertised") while the trace recorded the real
 * per-turn number — one report answered one question two ways, and the ceiling was
 * the one that was always wrong for the turn that actually failed. Chat #216 reported
 * "1 tool advertised per turn" with 15+ distinct tools called, because the registry
 * snapshot it measured had collapsed to one entry; the trace of what each turn was
 * actually handed said otherwise. Everything reads the trace now.
 */
import type { BrainTraceEvent } from './brainTriage';
import { FINISH_RECORD_TURNS, PROGRESS_FORCED_LABEL } from './runStore/progressFinishFacts';

/** Tool-catalog exposure for a run, read off the `llm` turns the loop records. */
export interface ToolExposure {
  /** Tools advertised on the LAST measured turn (what the model could call at the end). */
  lastTurn: number | null;
  /** Fewest tools advertised on any measured turn — a zero here explains everything. */
  min: number | null;
  /** Size of the whole registered catalog the selection drew from. */
  catalog: number | null;
}

/**
 * How many tools the model was actually OFFERED, per turn, versus how many exist.
 *
 * The registry-wide total is not the same question: a turn that was handed ZERO tools
 * and a turn that was handed sixty-four and ignored them produce byte-identical reports,
 * and only one of them is the model's fault. The loop records the real per-turn number
 * and this reads it back. Nulls when the run predates the field.
 */
export function toolExposureInTrace(events: readonly BrainTraceEvent[]): ToolExposure {
  let lastTurn: number | null = null;
  let min: number | null = null;
  let catalog: number | null = null;
  // The progress guard decided a FINISH (`loop.progress_forced`, `forced: 'finish'`): its final report offers nothing ON PURPOSE
  // (`runStore/progressGuard.ts`) — not a turn starved of tools (VS Code chat #165961). That report is the finish turn itself, or,
  // when the finish offered ticket tools (`recordTools`), comes after at most FINISH_RECORD_TURNS record turns. Only the first
  // no-tool turn inside that window is excused; the window closes on it or when it runs out.
  let finishTurnsLeft = 0;
  for (const ev of events) {
    if (ev.category === 'message' && ev.label === PROGRESS_FORCED_LABEL) {
      const f = ev.args as { forced?: unknown; recordTools?: unknown } | undefined;
      if (f?.forced === 'finish') finishTurnsLeft = typeof f.recordTools === 'number' && f.recordTools > 0 ? FINISH_RECORD_TURNS + 1 : 1;
    }
    if (ev.category !== 'llm') continue;
    const a = ev.args as { advertisedTools?: unknown; catalogTools?: unknown } | undefined;
    const finalReport = finishTurnsLeft > 0 && a?.advertisedTools === 0;
    if (typeof a?.advertisedTools === 'number') finishTurnsLeft = finalReport ? 0 : Math.max(0, finishTurnsLeft - 1);
    // The excused final report is not measured.
    if (!finalReport && typeof a?.advertisedTools === 'number') {
      lastTurn = a.advertisedTools;
      min = min == null ? a.advertisedTools : Math.min(min, a.advertisedTools);
    }
    if (typeof a?.catalogTools === 'number') catalog = a.catalogTools;
  }
  return { lastTurn, min, catalog };
}

/**
 * The per-turn half of the tool line: what the model was ACTUALLY handed, never a
 * ceiling derived from the registry size.
 *
 * Three states, deliberately distinct:
 *  - measured (a run has advertised tools)      → "40–64 advertised per turn (measured)"
 *  - unmeasured but the registry exceeds the cap → says the selection is capped and NOT
 *    yet measured, so nobody reads a bound as an observation
 *  - registry already under the cap              → nothing; every tool goes every turn
 *
 * `defaultToolLimit` is injected (rather than importing `@builderforce/agent-run`) to
 * keep this module free of a runtime dependency; the caller already holds the constant.
 */
export function formatAdvertised(
  tools: { advertisedLastTurn?: number | null; advertisedMin?: number | null; count: number },
  defaultToolLimit: number,
): string {
  const last = tools.advertisedLastTurn;
  const min = tools.advertisedMin;
  if (last != null) {
    const range = min != null && min !== last ? `${min}–${last}` : `${last}`;
    return ` · ${range} advertised per turn (measured)${min === 0 ? ' · ⚠ a turn was offered NONE' : ''}`;
  }
  if (tools.count > defaultToolLimit) {
    return ` · per-turn selection capped at ${defaultToolLimit}, not yet measured (no turn in this run advertised tools)`;
  }
  return '';
}
