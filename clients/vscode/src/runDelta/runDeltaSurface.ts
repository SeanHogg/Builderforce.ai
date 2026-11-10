/**
 * The workspace surface's run-delta requests (PRD 41 §C14, §12.5), out of `workspaceSurface.ts`:
 *   - `run-delta/open { runId, path, line? }` — a card's Open code, confined by the host to the paths that stored delta
 *     names, under its root (`RUN_DELTA_OPEN_REFUSED` otherwise);
 *   - `run-delta/release { runId }` — a person's audited release of a run held at its finalize gate; any refusal answers
 *     one of `RUN_DELTA_RELEASE_REFUSED` (`releaseHeldRun.ts`);
 *   - `run-delta/get { runId? | chatId? }` — a run's (or a chat's) cards again, for a reopened chat.
 * Every request is answered exactly once.
 */

import { RUN_DELTA_OPEN_REFUSED, RUN_DELTA_RELEASE_REFUSED } from "@builderforce/run-delta/contract";
import type { BrainRunHost } from "../brainRunHost";

/** The request types this module answers. */
export const RUN_DELTA_SURFACE_REQUESTS = ["run-delta/open", "run-delta/release", "run-delta/get"] as const;
export type RunDeltaSurfaceRequest = (typeof RUN_DELTA_SURFACE_REQUESTS)[number];

export const isRunDeltaSurfaceRequest = (type: string): type is RunDeltaSurfaceRequest =>
  (RUN_DELTA_SURFACE_REQUESTS as readonly string[]).includes(type);

export interface RunDeltaSurfaceDeps {
  runHost?: Pick<BrainRunHost, "openRunDeltaFile" | "releaseHeldRun" | "runDeltas">;
  /** Opens a confined absolute file at a line (`canvasHostActions.openCapturedFile`). */
  openFile(file: string, line?: number): Promise<void>;
  respond(ok: boolean, result?: unknown, error?: string): void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Answers one run-delta request. */
export async function handleRunDeltaRequest(type: RunDeltaSurfaceRequest, msg: Record<string, unknown>, deps: RunDeltaSurfaceDeps): Promise<void> {
  try {
    if (type === "run-delta/open") {
      const file = typeof msg.runId === "string" && typeof msg.path === "string"
        ? await deps.runHost?.openRunDeltaFile?.({ runId: msg.runId, path: msg.path })
        : undefined;
      if (!file) return deps.respond(false, undefined, RUN_DELTA_OPEN_REFUSED);
      const line = typeof msg.line === "number" && msg.line > 0 ? Math.floor(msg.line) : undefined;
      await deps.openFile(file, line);
      return deps.respond(true, true);
    }
    if (type === "run-delta/release") {
      if (typeof msg.runId !== "string" || !deps.runHost?.releaseHeldRun) return deps.respond(false, undefined, RUN_DELTA_RELEASE_REFUSED.notHeld);
      await deps.runHost.releaseHeldRun(msg.runId);
      return deps.respond(true, true);
    }
    const query = { ...(typeof msg.runId === "string" ? { runId: msg.runId } : {}), ...(typeof msg.chatId === "number" ? { chatId: msg.chatId } : {}) };
    deps.respond(true, (await deps.runHost?.runDeltas?.(query)) ?? []);
  } catch (error) {
    deps.respond(false, undefined, messageOf(error));
  }
}
