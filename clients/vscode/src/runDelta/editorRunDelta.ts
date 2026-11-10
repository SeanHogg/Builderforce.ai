/**
 * The run delta, assembled for the editor's host-owned runs (`brainRunHostPorts.ts`): what a run start hands the change set's
 * baseline (pre-images, the stat hint, the workspace folders), the `onFinalized` hook that starts the delta once the run has
 * settled, the finalize gate an autonomous run's terminal status waits on (`hold`, `runHoldGate.ts`, PRD 41 §12.5), the card
 * relay the chat panels attach to, and the `run-delta/get` read.
 *
 * The editor adapters (`runDeltaHost.ts` — knowledge store, folder SQLite) are loaded LAZILY, on the first run start: the run
 * host must not pull the knowledge host's module graph in at construction.
 */

import type { LocalFirstStore } from "@builderforce/local-first";
import type * as vscode from "vscode";
import type { RunHostMessage, RunSink } from "../brainRunHostProtocol";
import { hostLog } from "../hostLog";
import type { BaselineCaptureOptions } from "../runChangeBaseline";
import type { FinalizedRunChangeSets } from "../runChangeSets";
import { RUN_DELTA_BUDGET_MS, startRunDelta } from "./finalizeRunDelta";
import { runDeltaFile, type OpenCodeRequest } from "./openCode";
import { readRunDeltas, type RunDeltaCard } from "./runDeltaRecords";
import { createRunHoldGate, type RunHoldGate } from "./runHoldGate";

type DeltaHost = typeof import("./runDeltaHost");

export interface EditorRunDelta {
  /**
   * The finalize gate: `expect` an autonomous run the host owns as it starts; the run lifecycle's `beforeTerminal` waits
   * for its delta, and the start awaits the `verdict`. The change set's paths below tell it when the delta settled (or will
   * never come).
   */
  hold: Pick<RunHoldGate, "expect" | "beforeTerminal" | "verdict">;
  /** The baseline options of one run (resolves the adapters on first use). */
  capture(runId: string): Promise<BaselineCaptureOptions>;
  /**
   * The change set's `onFinalized` for one run: starts the delta, detached (an autonomous run's through its hold port).
   * `writes` is read then: the run's own file-tool writes (its write evidence), as recorded by the run host.
   */
  onFinalized(run: { chatId: number; mode: "interactive" | "autonomous"; writes?: () => readonly string[] | undefined; workspaceRoot?: string }):
    (closed: FinalizedRunChangeSets) => void;
  attach(sink: RunSink): () => void;
  runDeltas(query: { runId?: string; chatId?: number }): Promise<RunDeltaCard[]>;
  /** A card's Open code: the confined absolute file (`openCode.ts`), or undefined when refused. */
  openFile(request: OpenCodeRequest): Promise<string | undefined>;
}

const log = (what: string, error: unknown): void =>
  hostLog(`[run delta] ${what}: ${error instanceof Error ? error.message : String(error)}`);

export function editorRunDelta(args: {
  secrets: vscode.SecretStorage;
  store: LocalFirstStore;
  deviceId: () => string;
  workspaceFolders: () => string[];
}): EditorRunDelta {
  let host: Promise<DeltaHost> | undefined;
  const loadHost = (): Promise<DeltaHost> => (host ??= import("./runDeltaHost"));
  // The `run-delta/card` relay: every attached panel hears a stored delta (it shows it when it holds that chat).
  const sinks = new Set<RunSink>();
  const post = (card: RunDeltaCard): void => {
    const message: RunHostMessage = { type: "run-delta/card", ...card };
    for (const sink of sinks) {
      try { sink.post(message); } catch { /* a disposed panel; its detach follows */ }
    }
  };
  const gate = createRunHoldGate({
    budgetMs: RUN_DELTA_BUDGET_MS,
    onTimeout: (runId, ms) => log(`run ${runId}`, new Error(`run_hold_gate: no settled delta within ${ms} ms; the run is not held`)),
  });
  return {
    hold: gate,
    async capture(runId) {
      // `release` is the change set's exit that never reaches `onFinalized`: no delta will come, so the gate decides now.
      try {
        const h = await loadHost();
        return {
          preimages: h.preimageSinkFor(runId),
          hint: h.statHashHint(),
          folders: args.workspaceFolders(),
          onPreimageError: (error) => log("pre-images", error),
          release: () => {
            gate.port(runId).settled();
            void h.releaseRun(runId).catch((error: unknown) => log("pre-image release", error));
          },
        };
      } catch (error) {
        log("baseline adapters", error);
        return { folders: args.workspaceFolders(), release: () => gate.port(runId).settled() };
      }
    },
    onFinalized({ writes, ...run }) {
      return (closed) => {
        const written = writes?.();
        const hold = run.mode === "autonomous" ? gate.port(closed.runId) : undefined;
        void loadHost().then((h) => startRunDelta({
          store: args.store,
          deviceId: args.deviceId,
          sources: h.editorDeltaSources(args.secrets, log, closed.runId),
          release: h.releasePreimages,
          post,
          telemetry: h.deltaTelemetry(hostLog),
          onError: (error) => log(`run ${closed.runId}`, error),
        }, { ...run, closed, ...(written ? { writes: written } : {}), ...(hold ? { hold } : {}) }), (error: unknown) => {
          log("load", error);
          hold?.settled();
        });
      };
    },
    attach(sink) {
      sinks.add(sink);
      return () => { sinks.delete(sink); };
    },
    runDeltas: (query) => readRunDeltas(args.store, query),
    openFile: (request) => runDeltaFile(args.store, request),
  };
}
