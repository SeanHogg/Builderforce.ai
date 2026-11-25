/**
 * The editor shell's RETAINED command outputs — what `output_filter` reads, so a model that
 * wants to grep a 100-second type-check's output does not run the type-check again.
 *
 * Module-level for the same reason as the background jobs (`localShellJobs.ts`): the tool
 * adapter builds a fresh capability provider per call. Each output belongs to the RUN that
 * produced it (its owner): an id from another run reads nothing. Bounded twice — the last
 * {@link MAX_OUTPUTS_PER_RUN} per run, and {@link MAX_RETAINED_CHARS} in all, the least
 * recently used going first.
 */

import type { JobOwner } from "./localShellJobs";

export const MAX_OUTPUTS_PER_RUN = 20;
/** ~4 MB of text across every run. */
export const MAX_RETAINED_CHARS = 4 * 1024 * 1024;

interface Retained {
  owner: JobOwner;
  text: string;
}

/** Insertion order = recency: a read re-inserts. Keyed by owner AND id. */
const outputs = new Map<string, Retained>();
let totalChars = 0;
let nextId = 0;

const keyOf = (owner: JobOwner, id: string): string => `${owner ?? "-"}:${id}`;

function drop(key: string): void {
  const entry = outputs.get(key);
  if (!entry) return;
  totalChars -= entry.text.length;
  outputs.delete(key);
}

/** Keep `text` as the run's latest output; returns its id. A single output larger than the
 *  whole budget keeps its last {@link MAX_RETAINED_CHARS} chars. */
export function retainOutput(owner: JobOwner, text: string): string {
  const kept = text.length > MAX_RETAINED_CHARS ? text.slice(text.length - MAX_RETAINED_CHARS) : text;
  nextId += 1;
  const id = `out-${nextId}`;
  outputs.set(keyOf(owner, id), { owner, text: kept });
  totalChars += kept.length;
  const mine = [...outputs].filter(([, e]) => e.owner === owner);
  for (const [key] of mine.slice(0, Math.max(0, mine.length - MAX_OUTPUTS_PER_RUN))) drop(key);
  for (const key of outputs.keys()) {
    if (totalChars <= MAX_RETAINED_CHARS) break;
    drop(key);
  }
  return id;
}

/** A retained output of `owner`'s, or undefined (another run's id, or evicted). */
export function readOutput(owner: JobOwner, id: string): string | undefined {
  const key = keyOf(owner, id);
  const entry = outputs.get(key);
  if (!entry) return undefined;
  outputs.delete(key);
  outputs.set(key, entry);
  return entry.text;
}

/** Forget a run's outputs — the run settled. */
export function forgetRunOutputs(owner: JobOwner): void {
  for (const [key, entry] of [...outputs]) if (entry.owner === owner) drop(key);
}
