/**
 * The `composing` phase — a turn that is streaming a TOOL CALL, made visible.
 *
 * The run loop published its live phase off text deltas alone. A turn that emits no
 * prose and one large tool call therefore showed nothing: chat #113 streamed
 * "Writing the Advisor Platform PRD and filing the epic now." and then sat on
 * "streaming the reply" for 3m 23s while the model pushed 21 KB of `write_file`
 * arguments down the wire. Every byte of that was progress, and none of it was on
 * screen — the one failure mode that makes a working agent indistinguishable from a
 * wedged one.
 *
 * This module owns the whole of that behaviour: a factory that builds the
 * `onToolCallDelta` member of `StreamHandlers` for one turn. It lives here rather
 * than in `brainRunStore.ts` because that file is already ~2,700 lines, and because a
 * pure fold over deltas is testable in isolation while a run-loop closure is not.
 *
 * Pure except for the injected sink and clock.
 */

import type { BrainRunActivity } from './runActivity';

/**
 * Where a composing update goes. Deliberately three narrow callbacks rather than the
 * run cell itself, so this module never learns what a `RunCell` is:
 *
 * - `set`              — store the activity value (no repaint of its own).
 * - `repaint`          — draw NOW. A phase change must not wait for a frame.
 * - `coalescedRepaint` — draw within a frame, folding every delta that lands meanwhile.
 *   Argument fragments arrive as fast as tokens do, so the steady state has to cost a
 *   frame, not a render per fragment.
 */
export interface ComposingSink {
  set(activity: BrainRunActivity): void;
  repaint(): void;
  coalescedRepaint(): void;
}

export interface ComposingOptions {
  /** 1-based agent-loop iteration this turn belongs to. */
  step: number;
  /** Clock, injected so the tests own it. Defaults to `Date.now`. */
  now?: () => number;
}

/** One turn's composing tracker. `reset` starts it over for a retried turn. */
export interface ComposingActivity {
  /** Wire this as `StreamHandlers.onToolCallDelta`. */
  onDelta(index: number, partial: { id?: string; name?: string; argsFragment?: string }): void;
  /** Argument bytes seen so far this turn. */
  bytes(): number;
  /** Discard the attempt — a stream-interrupt retry re-streams the whole turn. */
  reset(): void;
}

/** UTF-8 byte length of a string. What the wire actually carried, not its char count. */
export function utf8ByteLength(text: string): number {
  if (!text) return 0;
  // TextEncoder is present in every runtime this package targets (browser, worker,
  // Node ≥ 11); the fallback keeps a hostile environment from throwing on a hot path.
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Total argument bytes of a turn's assembled tool calls — the settled twin of
 *  {@link ComposingActivity.bytes}, for the durable turn record. */
export function toolCallArgBytes(calls: ReadonlyArray<{ args?: string }>): number {
  let total = 0;
  for (const c of calls) total += utf8ByteLength(c.args ?? '');
  return total;
}

/**
 * Build the `onToolCallDelta` handler for one turn.
 *
 * On the first fragment it publishes the `composing` phase and repaints immediately —
 * a phase change the user is waiting on must never trail a frame. Every later fragment
 * adds its bytes and repaints on the coalesced path.
 *
 * `startedAt` is stamped ONCE and held. The live renderer re-seeds its elapsed ticker
 * whenever `startedAt` changes, so re-stamping it per delta would pin the clock at 0s
 * for the entire three minutes — the exact reassurance this phase exists to give.
 */
export function createComposingActivity(sink: ComposingSink, opts: ComposingOptions): ComposingActivity {
  const now = opts.now ?? Date.now;
  /** Tool name per stream index — a turn can compose more than one call. */
  let names = new Map<number, string>();
  let bytes = 0;
  let startedAt: number | null = null;
  /** The name last PUBLISHED, so a name arriving after a nameless first fragment is
   *  recognized as new information rather than folded into the next frame. */
  let published: string | undefined;

  const publish = (label: string | undefined, immediate: boolean): void => {
    sink.set({
      phase: 'composing',
      startedAt: startedAt as number,
      step: opts.step,
      bytes,
      ...(label ? { label } : {}),
    });
    published = label;
    if (immediate) sink.repaint();
    else sink.coalescedRepaint();
  };

  return {
    onDelta(index, partial) {
      if (partial.name) names.set(index, partial.name);
      bytes += utf8ByteLength(partial.argsFragment ?? '');
      // The call currently being composed: this index's name, else the last one named
      // (a provider sends the name once and then bare argument fragments).
      const label = names.get(index) ?? published;
      if (startedAt === null) {
        startedAt = now();
        publish(label, true);
        return;
      }
      // A name that arrives after a nameless opening fragment completes the phase
      // announcement, so it draws now rather than waiting for the next frame.
      publish(label, !published && !!label);
    },
    bytes() {
      return bytes;
    },
    reset() {
      names = new Map();
      bytes = 0;
      startedAt = null;
      published = undefined;
    },
  };
}
