/**
 * What an extraction does with one job (PRD 41 A8), in a worker thread or, when the pool is down, in
 * the extension host: memory's pure `extractJob` over the SAME pack list the host's review composes
 * (`reviewPacks`, agent-tools — code before docs). ONE code path, so a pooled and an in-thread review
 * extract the same bytes.
 *
 * Packs are not serializable, so the worker builds its own. The one thing a job cannot carry on its own
 * is the host's warm symbol index, so the main thread puts a hit in the job as plain data
 * (`HostExtractJob.symbols`). ONE symbol rule on both paths: an index HIT uses the index's symbols, a MISS
 * uses the pack's regex extractor. (A tree-sitter miss path cannot exist in-thread: the pack's
 * `symbolsOf` is synchronous and tree-sitter loads asynchronously.) `sectionsOnly` jobs read no symbols.
 */

import type { CodeSymbol } from "@builderforce/agent-tools";
import { reviewPacks } from "@builderforce/agent-tools/knowledge";
import { extractJob, type ExtractJob, type ExtractJobResult } from "@seanhogg/builderforce-memory/knowledge";

/** Memory's job plus the index's definitions of the file, when the index holds it. */
export type HostExtractJob = ExtractJob & { symbols?: readonly CodeSymbol[] };

export async function handleExtractJob(job: HostExtractJob): Promise<ExtractJobResult> {
  const symbols = job.sectionsOnly ? undefined : job.symbols;
  return extractJob(job, reviewPacks(symbols ? { symbolsOf: () => symbols } : {}));
}
