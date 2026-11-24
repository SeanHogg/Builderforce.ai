/**
 * One graph build as PLAIN DATA ({@link GraphBuildRequest}) and the function that runs it — the body of the graph worker
 * (`graphWorkerEntry.ts`) and the in-thread fallback of its host (`graphWorker.ts`, no worker file in a test or a dev run).
 * It calls THE builders — agent-tools' `buildStoredGraph`, `packGraph` and `codeGraphFindings` — with the packs rebuilt from the layer
 * registry (`reviewPacks`: the build reads only the packs' layers and finding rules; their parsers and analyzers are the
 * review's), so a worker build and an in-thread build are the same build.
 *
 * Findings: memory's built-in knowledge rules and the code pack's (`unusedCodeRule` over `CODE_FACT_RULES`) are global rules
 * over the build's own graph, so the build computes them here, with no `FindingsProvider` — nothing of the host crosses.
 *
 * Runs inside a `worker_threads` worker: nothing here (nor anything it imports) may reach `vscode`.
 */

import { buildStoredGraph, codeGraphFindings, packGraph, reviewPacks, type CodeGraphFindings } from "@builderforce/agent-tools/knowledge";
import type { KnowledgeGraph, KnowledgeStore } from "@seanhogg/builderforce-memory/knowledge";
import type { IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import type { GraphBuildRequest, GraphBuildResult } from "./graphBuildProtocol";
import { readPackFile } from "./packs/packFile";

/**
 * A folder's knowledge, as a build reads it; undefined ⇒ the folder has no knowledge file (never reviewed). `releaseExtracted`,
 * when present, runs after each stored build: a long-lived store drops the bodies it read (they reload lazily).
 */
export type FolderStores = (folderPath: string) => { store: KnowledgeStore; manifest: IngestManifest; releaseExtracted?(): Promise<unknown> } | undefined;

/** The build of `request`, in THIS thread, reading stored knowledge through `stores`. */
export async function runGraphBuild<R extends GraphBuildRequest>(request: R, stores: FolderStores): Promise<GraphBuildResult<R>> {
  return (await buildOf(request, stores)) as GraphBuildResult<R>;
}

async function buildOf(request: GraphBuildRequest, stores: FolderStores): Promise<KnowledgeGraph | CodeGraphFindings | null> {
  if (request.kind === "extracted") return codeGraphFindings(request.rootId, request.extracted, request.partitions);
  if (request.kind === "pack") {
    return packGraph(await readPackFile(request.file), {
      ...(request.focus ? { focus: request.focus } : {}),
      ...(request.maxNodes ? { maxNodes: request.maxNodes } : {}),
    });
  }
  const opened = stores(request.folderPath);
  if (!opened) return null;
  try {
    return await buildStoredGraph({
      rootId: request.rootId, store: opened.store, manifest: opened.manifest,
      packs: reviewPacks(request.partitions ? { partitions: request.partitions } : {}),
      ...(request.nearDuplicates ? { nearDuplicates: request.nearDuplicates } : {}),
      ...(request.focus ? { focus: request.focus } : {}),
      ...(request.maxNodes ? { maxNodes: request.maxNodes } : {}),
      ...(request.hashOverrides ? { hashOverrides: request.hashOverrides } : {}),
    });
  } finally {
    await opened.releaseExtracted?.();
  }
}
