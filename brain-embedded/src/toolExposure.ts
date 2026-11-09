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
  for (const ev of events) {
    if (ev.category !== 'llm') continue;
    const a = ev.args as { advertisedTools?: unknown; catalogTools?: unknown } | undefined;
    if (typeof a?.advertisedTools === 'number') {
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
