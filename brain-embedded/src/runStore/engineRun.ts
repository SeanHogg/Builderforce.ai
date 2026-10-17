/**
 * Hosting a run that is not a chat's — the ONE run store for every agent turn in the
 * product. A chat's run (`startRun`) composes the Brain loop; a canvas turn composes the
 * canvas loop (board snapshot, proposal staging, the authoring and recovery ladders).
 * Both drive the one kernel (`@builderforce/agent-loop`); this is where the second one
 * gets the same CELL the first lives in:
 *
 *   - single-flight per key — a second start while one runs is refused, so two mounted
 *     surfaces (the Chat lens and the board dock) can never double-fire a turn;
 *   - the run outlives the component that started it (navigation, lens switches);
 *   - Stop (`stopRun`), the confirmation gate (`requestRunConfirm` / `resolveRunConfirm`,
 *     rendered by the shared ToolConfirmBar), the live trace and in-flight activity,
 *     and a thrown error's actionable verdict (`chatErrorAction`) — observed through the
 *     same snapshot (`subscribeRun` / `getRunSnapshot`) every chat surface renders.
 *
 * The engine owns its own persistence (a canvas session writes its own timeline), so
 * nothing here writes to a chat.
 */

import type { BrainMessage } from '../types';
import type { BrainTraceEvent } from '../brainTriage';
import type { BrainRunActivity } from '../runActivity';
import { chatErrorAction } from '../chatError';
import { emit, emitStreaming, getCell, pushTrace, recordAppended, recordRunFailure, setActivity } from './runCells';
import { beginRun } from './beginRun';
import { requestRunConfirm } from './runControl';
import type { RunKey } from './runTypes';

/** What an engine reports into, and asks through, its run cell. */
export interface RunEngineControl {
  /** Aborted by `stopRun(key)` — every await the engine makes should honour it. */
  readonly signal: AbortSignal;
  /** Record a completed step on the live trace. */
  trace(event: BrainTraceEvent): void;
  /** Replace the text streaming right now ('' clears it). Repaints are coalesced. */
  stream(text: string): void;
  /** Publish the in-flight step (null when between steps). */
  activity(activity: BrainRunActivity | null): void;
  /** Ask the human about one tool call; resolves false on decline or Stop. */
  confirm(req: { name: string; args: unknown }): Promise<boolean>;
  /** A message the engine persisted, for live splice-in by mounted views. */
  append(message: BrainMessage): void;
}

/** A run's body. Resolve when the turn is settled; throw to surface an error. */
export type BrainRunEngine = (control: RunEngineControl) => Promise<void>;

/**
 * Start an engine-hosted run on `key`. Returns false (and runs nothing) when a run is
 * already in flight on that key. A throw that is not a Stop becomes the cell's error,
 * with its actionable verdict, and a durable trace row.
 */
export async function startEngineRun(key: RunKey, engine: BrainRunEngine): Promise<boolean> {
  const c = getCell(key);
  if (c.running) return false;
  // An engine's trace is ONE turn's: the canvas keeps each turn's steps on its own
  // record (the chat object), so the live trace starts empty rather than carrying the
  // session's earlier turns the way a chat cell does for triage.
  c.trace = [];
  beginRun(c);
  emit(c);
  const signal = c.abort!.signal;
  const control: RunEngineControl = {
    signal,
    trace: (event) => pushTrace(c, event),
    stream: (text) => { c.streamingText = text; emitStreaming(c); },
    activity: (activity) => setActivity(c, activity),
    confirm: (req) => requestRunConfirm(key, req),
    append: (message) => { recordAppended(c, message); emit(c); },
  };
  try {
    await engine(control);
  } catch (e) {
    if (!signal.aborted) {
      c.error = e instanceof Error ? e.message : 'Reply failed';
      c.errorAction = chatErrorAction(e);
      recordRunFailure(c, 'agent.run', c.error);
    }
  } finally {
    c.running = false;
    c.streamingText = '';
    c.abort = null;
    c.activity = null;
    c.pendingConfirm = null;
    c.confirmResolver = null;
    emit(c);
  }
  return true;
}
