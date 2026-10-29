/**
 * The per-run reset every run makes as it claims its cell — chat runs (`startRun`) and
 * engine-hosted runs (`startEngineRun`) alike: a fresh error, stream, banners, backstop
 * bookkeeping and abort handle, and an immediate "starting" activity so the surface has
 * something to show between acceptance and the first token. Does not emit; the caller
 * finishes its own setup first.
 */

import { runOutcomeId } from '../runOutcomeReport';
import type { RunCell } from './runCell';
import type { RunKey } from './runTypes';

export function beginRun(c: RunCell, outcomeKey?: RunKey): void {
  c.running = true;
  c.claim = null; // a run that started under a claim consumes it
  c.error = '';
  c.errorAction = null;
  c.streamingText = '';
  c.byoUnresolved = []; // fresh per run — a reconnected account clears the banner
  c.providerCap = [];   // fresh per run — a topped-up account clears the banner
  // Fresh backstop bookkeeping per run (see startRun's finally block).
  c.codeChanged = false;
  c.ticketRecorded = false;
  c.touchedFiles = [];
  c.deltaTicketId = null;
  c.deltaRecordedFiles = [];
  c.runTraceFrom = c.trace.length;
  c.codeModel = null;
  c.liveTurn = null;
  c.stoppedTurn = null;
  c.turn = null;
  if (typeof outcomeKey === 'number') c.runId = runOutcomeId(outcomeKey, Date.now());
  // Fresh abort handle for this run, so Stop can cancel the LLM stream and unwind
  // the loop (a stale, already-aborted controller never bleeds into a new run).
  c.abort = new AbortController();
  // Show something the instant the run is accepted. Between here and the first
  // token the surface would otherwise have nothing at all to render.
  c.activity = { phase: 'starting', startedAt: Date.now(), step: 0 };
}
