/**
 * What the HOST hands a run before its first turn (PRD 35 E2 / E7), gathered in one
 * parallel wait: the recall hint (its context pack's focus files + headings), the task
 * context block, the files that block served whole, and the model preflight.
 *
 * Every part is best-effort. A part that throws costs that part, never the run — and the
 * reason is kept on the run's trace (`host.context_failed`) rather than swallowed.
 */

import type { ReadCoverage } from '../readCoverage';
import type { RunCell } from './runCell';
import { nowIso, pushTrace } from './runCells';
import { applyModelPreflight } from './modelPreflight';
import type { BrainRunRequest } from './runTypes';

/** A file the host showed the model WHOLE, before the run read anything. */
export interface ServedRead {
  /** Workspace-relative path, as `read_file` takes it. */
  path: string;
  /** The whole file, exactly as served. */
  content: string;
  totalLines: number;
}

export interface HostRunContext {
  recallHint?: string;
  turnContext?: string;
  servedReads: readonly ServedRead[];
}

/** One host part: its value, or undefined (with the reason on the trace) when it threw. */
async function hostPart<T>(c: RunCell, part: string, read: (() => Promise<T | undefined>) | undefined): Promise<T | undefined> {
  if (!read) return undefined;
  try {
    return await read();
  } catch (e) {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'host.context_failed',
      args: { part },
      result: `The host's ${part} could not be read (${e instanceof Error ? e.message : String(e)}) — the run starts without it.`,
    });
    return undefined;
  }
}

/** Await every host part at once. `recall` false ⇒ no recall hint is asked for. */
export async function gatherHostRunContext(c: RunCell, req: BrainRunRequest, recall: boolean): Promise<HostRunContext> {
  const [recallHint, turnContext, servedReads] = await Promise.all([
    recall ? hostPart(c, 'recall hint', req.recallHint) : Promise.resolve(undefined),
    hostPart(c, 'task context', req.turnContext),
    hostPart(c, 'served reads', req.servedReads),
    // The model preflight (E7): an account that cannot serve this run is shown on the
    // banner BEFORE the first turn, not after it.
    applyModelPreflight(c, req.modelPreflight, req.model),
  ]);
  return {
    ...(recallHint ? { recallHint } : {}),
    ...(turnContext?.trim() ? { turnContext } : {}),
    servedReads: servedReads ?? [],
  };
}

/**
 * Record each served file as the whole-file `read_file` it stands for, anchored to the
 * message that carries the block — so a later read of it is a repeat while that message
 * is in the working context, and a replay from this cache once it is not.
 */
export function recordServedReads(coverage: ReadCoverage, reads: readonly ServedRead[], anchor: unknown): void {
  for (const read of reads) {
    if (!read.path) continue;
    const args = { path: read.path };
    coverage.record('read_file', args);
    coverage.cacheResult('read_file', args, {
      result: { ok: true, path: read.path, content: read.content, totalLines: read.totalLines, offset: 1, truncated: false },
      anchor,
    });
  }
}
