/**
 * THE ON-PREM KNOWLEDGE HOST (PRD 38 §4.7, on-prem / container row) — ports only, the same
 * review composition the editor runs (`@builderforce/agent-tools/knowledge` `reviewRunner`):
 *
 *   source     — the container fs (`containerKnowledgeFs.ts`), the ONE walker;
 *   store      — the platform (`@builderforce/knowledge-client`) with this agent's key, through
 *                the agent-host door, for the project the host is linked to — on-prem
 *                has no local-only mode: unlinked, it offers no review;
 *   review     — the agent runtime: the on-prem symbol index, the code pack's analyzers
 *                through this runtime's shell (the snapshot uploaded, `PUT …/code-analysis`),
 *                the platform's routed judgement, the knowledge index's `similar`;
 *   graph      — the web canvas's `knowledge` surface, linked from the answer.
 *
 * The rows themselves (`/review`, `/graph`) are the shared ones; this file supplies the
 * host half and merges them into the on-prem PreFetch port.
 */

import path from "node:path";
import { basename, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import {
  claimSimilarity, fileManifest, indexedSymbolSource, manifestFileName, migratingRootFiles, planKnowledgeReviewDetail,
  reviewPacks, rootManifest, runKnowledgeReview, watchFileEdits, workspaceCodeAnalyzers, createFsDirectorySource, type KnowledgeReviewPorts,
} from "@builderforce/agent-tools/knowledge/index.js";
import {
  graphShown, knowledgeSurfaceQuery, readPartitions, withKnowledgeRows, type KnowledgeRowsHost,
} from "@builderforce/agent-tools/prefetch/index.js";
import { createKnowledgeClient, type AnalysisSnapshotPayload, type KnowledgeClient } from "@builderforce/knowledge-client";
import { defineRegistry, type PrefetchPort } from "@builderforce/prefetch";
import { repoMapPort } from "@builderforce/repo-map";
import { readSharedEnvVar } from "../../infra/env-file.js";
import { logDebug } from "../../logger.js";
import { getKnowledgeLoopService } from "../../infra/knowledge-loop.js";
import { authHeaders, type ProjectEvermindSyncConfig } from "../../infra/project-evermind-sync.js";
import { normalizeBaseUrl } from "../../utils/normalize-base-url.js";
import { onPremSymbolIndex } from "../on-prem-symbol-index.js";
import { containerKnowledgeFiles, containerKnowledgeFs } from "./containerKnowledgeFs.js";
import { getHostKnowledgeIndex, onPremLegacyRootId, onPremRootId } from "./index/onPremKnowledgeIndex.js";

const DEFAULT_WEB_URL = "https://builderforce.ai";
/** The agent-host key door the knowledge routes are mounted under (the API's `agentHostDoor`). */
const AGENT_DOOR_BASE_PATH = "/api/agent/projects";

/** The project link `onPremKnowledgeClient` needs — the knowledge loop's config. */
export type OnPremKnowledgeLink = Pick<ProjectEvermindSyncConfig, "gatewayUrl" | "apiKey" | "agentHostId" | "projectId">;

/**
 * The platform client for this host's project, with the agent's key; undefined when unlinked.
 * It speaks through the agent-host door (`/api/agent/projects`, `Bearer` + `X-AgentHost-Id`)
 * — the tenant door under `/api/projects` takes a person's JWT only. The link is the SAME
 * one the facts and Evermind syncs use (`KnowledgeLoopService.projectEvermindConfig`), with
 * the same headers (`authHeaders`), never a second read of the environment.
 */
export function onPremKnowledgeClient(
  link: OnPremKnowledgeLink | null = getKnowledgeLoopService()?.projectEvermindConfig() ?? null,
): { client: KnowledgeClient; projectId: number } | undefined {
  if (!link) return undefined;
  const origin = normalizeBaseUrl(link.gatewayUrl);
  const client = createKnowledgeClient({
    projectId: link.projectId,
    basePath: AGENT_DOOR_BASE_PATH,
    fetch: (path, init) => fetch(`${origin}${path}`, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), ...authHeaders(link) },
    }),
  });
  return { client, projectId: link.projectId };
}

/** Where the web app is — the graph is drawn there for an on-prem run. */
function webBaseUrl(): string {
  return (process.env.BUILDERFORCE_WEB_URL?.trim() || readSharedEnvVar("BUILDERFORCE_WEB_URL")?.trim() || DEFAULT_WEB_URL).replace(/\/+$/, "");
}

/** The web canvas's `knowledge` surface for the project (the project route opens its board there), focused on `focus` as the surface reads it. */
export function knowledgeSurfaceUrl(projectId: number, focus: readonly string[] = []): string {
  return `${webBaseUrl()}/projects/${projectId}?${knowledgeSurfaceQuery(focus)}`;
}

/**
 * A best-effort step's rejection, recorded with its reason and replaced by `fallback` — the
 * review still runs without the symbol index, the knowledge index or the platform's graph.
 */
function loggedFallback<T>(step: string, fallback: T): (error: unknown) => T {
  return (error) => {
    logDebug(`[knowledge] ${step} failed: ${String(error)}`);
    return fallback;
  };
}

/** The workspace-relative form of `target`, or undefined when it lies outside the workspace (another drive included). */
export function insideWorkspace(root: string, target: string, p: Pick<typeof path, "relative" | "isAbsolute" | "sep"> = path): string | undefined {
  const rel = p.relative(root, target);
  if (p.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${p.sep}`)) return undefined;
  return rel.split(p.sep).join("/");
}

/** Whether `target` is inside the workspace once symlinks are resolved on both: reject folders outside the workspace. */
export async function withinRealWorkspace(root: string, target: string): Promise<boolean> {
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    return insideWorkspace(realRoot, realTarget) !== undefined;
  } catch {
    return false;
  }
}

async function isFolder(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isDirectory(), () => false);
}

/** Reviewed roots whose files are watched, so an edit marks what was judged from it stale (§5.2). */
const watchedRoots = new Map<string, () => void>();
let stopAtExit = false;

/** Stops every folder watch (shutdown; tests). */
export function stopKnowledgeWatchers(): void {
  for (const stop of watchedRoots.values()) stop();
  watchedRoots.clear();
}

/**
 * After a review: watch the root, applying the shared stale-marking to every file the
 * watcher reports. A root reviewed again gets a fresh watch (the old one is stopped), and
 * all of them stop when the process does.
 */
function keepFresh(deps: OnPremKnowledgeDeps, rootId: string, rel: string, ports: KnowledgeReviewPorts): void {
  watchedRoots.get(rootId)?.();
  watchedRoots.delete(rootId);
  const stop = watchFileEdits({
    rootId,
    rootPath: rel ? resolve(deps.workspaceRoot, rel) : resolve(deps.workspaceRoot),
    fs: containerKnowledgeFs,
    source: ports.source,
    store: ports.store,
    manifest: ports.manifest,
    // No symbol index: an edited file is read from its NEW content, not from definitions known before the edit.
    packs: reviewPacks(ports.partitions ? { partitions: ports.partitions } : {}),
    onError: loggedFallback("stale marking", undefined),
  });
  if (!stop) return;
  watchedRoots.set(rootId, stop);
  if (!stopAtExit) {
    stopAtExit = true;
    process.once("exit", stopKnowledgeWatchers);
  }
}

export interface OnPremKnowledgeDeps {
  workspaceRoot: string;
  caps: CapabilityProvider;
  linked: { client: KnowledgeClient; projectId: number };
}

/** The review ports for one folder of the workspace. */
async function reviewPorts(deps: OnPremKnowledgeDeps, rel: string, rootId: string, title: string): Promise<KnowledgeReviewPorts> {
  const { workspaceRoot, caps, linked } = deps;
  const partitions = await readPartitions({ caps });
  const symbols = await onPremSymbolIndex(workspaceRoot).filesUnder(rel || undefined).catch(loggedFallback("symbol index", []));
  const index = await getHostKnowledgeIndex(rootId).catch(loggedFallback("knowledge index", undefined));
  // The root's ONE manifest (the review and the folder watch share it). The store is the
  // linked client's, taken fresh each time so a rotated API key is picked up. A root reviewed
  // under its old, name-based id keeps its manifest: migrated on first read.
  const shared = {
    store: linked.client.store,
    manifest: rootManifest(rootId, () => fileManifest(
      migratingRootFiles(containerKnowledgeFiles(workspaceRoot), rootId, onPremLegacyRootId(workspaceRoot, rel)),
      manifestFileName(rootId),
    ), workspaceRoot),
  };
  return {
    source: createFsDirectorySource({
      fs: containerKnowledgeFs, rootPath: rel ? resolve(workspaceRoot, rel) : workspaceRoot, rootId, title,
    }),
    store: shared.store,
    manifest: shared.manifest,
    partitions,
    symbolsOf: indexedSymbolSource(symbols, rel),
    analyzers: workspaceCodeAnalyzers({
      caps,
      partitions,
      repoGraph: repoMapPort,
      ...(rel ? { path: rel } : {}),
      upload: (sha, snapshot) => linked.client.putAnalysis(sha, snapshot as unknown as AnalysisSnapshotPayload),
      onUploadError: (error) => logDebug(`[knowledge] analysis upload failed: ${String(error)}`),
      onWarn: (message) => logDebug(`[knowledge] analysis: ${message}`),
    }),
    judgement: linked.client.judgement,
    // After the review the root's graph feeds the knowledge index (the shared runner does it).
    index: { upsertFromGraph: async (graph) => (await getHostKnowledgeIndex(rootId)).upsertFromGraph(graph) },
    platformGraph: (id) => linked.client.graph(id),
    onIndexError: loggedFallback("knowledge index update", undefined),
    ...(index ? { similar: claimSimilarity(index, shared.store, rootId) } : {}),
  };
}

export function onPremKnowledgeRowsHost(deps: OnPremKnowledgeDeps): KnowledgeRowsHost {
  const root = resolve(deps.workspaceRoot);
  const base = onPremRootId(root);
  return {
    async openReview(dir) {
      const target = resolve(root, dir || ".");
      const rel = insideWorkspace(root, target);
      if (rel === undefined || !(await isFolder(target)) || !(await withinRealWorkspace(root, target))) return null;
      const rootId = onPremRootId(root, rel);
      const title = rel ? rel.slice(rel.lastIndexOf("/") + 1) : basename(root) || "workspace";
      let ports: Promise<KnowledgeReviewPorts> | undefined;
      const portsOnce = () => (ports ??= reviewPorts(deps, rel, rootId, title));
      return {
        rootId,
        title,
        plan: async () => planKnowledgeReviewDetail(await portsOnce()),
        async review(plan, signal) {
          const p = await portsOnce();
          const report = await runKnowledgeReview(p, { signal, plan });
          keepFresh(deps, rootId, rel, p);
          return report;
        },
      };
    },
    // Unlinked hosts offer no review, so the platform's routed judgement is always the call being priced.
    callPrice: () => deps.linked.client.judgeEstimate(),
    rootId: () => base,
    async showGraph(rootId, focus) {
      const url = knowledgeSurfaceUrl(deps.linked.projectId, focus);
      const named = focus.length > 0 ? ` It opens on the project's board, focused on the ${focus.length} file(s) named here.` : "";
      return graphShown(`The knowledge graph of **${rootId}** is on the project's canvas: [Open the knowledge graph](${url}).${named}`, rootId, focus);
    },
  };
}

/** The on-prem port with the knowledge rows merged in, when the host is linked to a project. */
export function withOnPremKnowledgeRows(port: PrefetchPort, deps: Omit<OnPremKnowledgeDeps, "linked">): PrefetchPort {
  const linked = onPremKnowledgeClient();
  if (!linked) return port;
  return withKnowledgeRows(port, onPremKnowledgeRowsHost({ ...deps, linked }), defineRegistry);
}
