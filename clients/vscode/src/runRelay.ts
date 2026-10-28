/**
 * The host's relay to its panels: every attached sink, and what each was last sent of
 * each run (the delta bookkeeping `syncMessageFor` keeps). Lifted out of `brainRunHost.ts`,
 * which owns the runs; this owns only who hears about them.
 */

import { syncMessageFor, type RunHostMessage, type RunSink, type SinkEntry } from "./brainRunHostProtocol";

export interface RunRelay {
  /** One message, to every panel. */
  broadcast(message: RunHostMessage): void;
  /** A run's change, to every panel — each gets the delta from what IT was last sent. */
  sync(runKey: number): void;
  /** Drop what every panel was sent of a run: its next frame is whole. */
  forget(runKey: number): void;
  /**
   * A panel's copy of a run fell out of step (its store evicted the cell between runs, so
   * a delta would rebuild a short list): send the run whole. To every panel — the request
   * is rare and a whole frame is always correct.
   */
  resync(runKey: number): void;
  /** A new panel: brought up to date on `runKeys`, then on every change. Returns the detach. */
  attach(sink: RunSink, runKeys: readonly number[]): () => void;
  dispose(): void;
}

export function createRunRelay(): RunRelay {
  const sinks = new Set<SinkEntry>();
  const forget = (runKey: number): void => {
    for (const entry of sinks) entry.sent.delete(runKey);
  };
  const sync = (runKey: number): void => {
    for (const entry of sinks) entry.sink.post(syncMessageFor(entry, runKey));
  };
  return {
    broadcast(message) {
      for (const entry of sinks) entry.sink.post(message);
    },
    sync,
    forget,
    resync(runKey) {
      forget(runKey);
      sync(runKey);
    },
    attach(sink, runKeys) {
      const entry: SinkEntry = { sink, sent: new Map() };
      sinks.add(entry);
      for (const runKey of runKeys) sink.post(syncMessageFor(entry, runKey));
      return () => {
        sinks.delete(entry);
      };
    },
    dispose() {
      sinks.clear();
    },
  };
}
