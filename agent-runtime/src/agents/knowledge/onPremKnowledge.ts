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

import { basename, resolve, relative, sep } from "node:path";
import { stat } from "node:fs/promises";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import {
  buildStoredGraph, fileManifest, indexedSymbolSource, manifestFileName, migratingRootFiles, planKnowledgeReview, reviewPacks,
  runKnowledgeReview, workspaceCodeAnalyzers, createFsDirectorySource, type KnowledgeReviewPorts,
} from "@builderforce/agent-tools/knowledge/index.js";
import { readPartitions, withKnowledgeRows, type KnowledgeRowsHost } from "@builderforce/agent-tools/prefetch/index.js";
import { createKnowledgeClient, type AnalysisSnapshotPayload, type KnowledgeClient } from "@builderforce/knowledge-client";
import { defineRegistry, type PrefetchPort } from "@builderforce/prefetch";
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

/** The web canvas's `knowledge` surface for the project (the project route opens its board there). */
export function knowledgeSurfaceUrl(projectId: number): string {
  return `${webBaseUrl()}/projects/${projectId}?surface=knowledge`;
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

async function isFolder(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isDirectory(), () => false);
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
  return {
    source: createFsDirectorySource({
      fs: containerKnowledgeFs, rootPath: rel ? resolve(workspaceRoot, rel) : workspaceRoot, rootId, title,
    }),
    store: linked.client.store,
    // A root reviewed under its old, name-based id keeps its manifest: migrated on first read.
    manifest: fileManifest(
      migratingRootFiles(containerKnowledgeFiles(workspaceRoot), rootId, onPremLegacyRootId(workspaceRoot, rel)),
      manifestFileName(rootId),
    ),
    partitions,
    symbolsOf: indexedSymbolSource(symbols, rel),
    analyzers: workspaceCodeAnalyzers({
      caps,
      partitions,
      ...(rel ? { path: rel } : {}),
      upload: (sha, snapshot) => linked.client.putAnalysis(sha, snapshot as unknown as AnalysisSnapshotPayload),
      onUploadError: (error) => logDebug(`[knowledge] analysis upload failed: ${String(error)}`),
    }),
    judgement: linked.client.judgement,
    ...(index ? { similar: (ids: string[]) => index.similar(ids) } : {}),
  };
}

export function onPremKnowledgeRowsHost(deps: OnPremKnowledgeDeps): KnowledgeRowsHost {
  const root = resolve(deps.workspaceRoot);
  const base = onPremRootId(root);
  return {
    async openReview(dir) {
      const target = resolve(root, dir || ".");
      const rel = relative(root, target).split(sep).join("/");
      if (rel.startsWith("..") || !(await isFolder(target))) return null;
      const rootId = onPremRootId(root, rel);
      const title = rel ? rel.slice(rel.lastIndexOf("/") + 1) : basename(root) || "workspace";
      let ports: Promise<KnowledgeReviewPorts> | undefined;
      const portsOnce = () => (ports ??= reviewPorts(deps, rel, rootId, title));
      return {
        rootId,
        title,
        plan: async () => planKnowledgeReview(await portsOnce()),
        async review(_plan, signal) {
          const p = await portsOnce();
          const report = await runKnowledgeReview(p, { signal });
          // The review's graph feeds the knowledge index (§4.3, last step).
          const graph = await deps.linked.client.graph(rootId).catch(loggedFallback("platform graph", null))
            ?? await buildStoredGraph({ rootId, store: p.store, manifest: p.manifest, packs: reviewPacks(p) });
          if (graph) await (await getHostKnowledgeIndex(rootId)).upsertFromGraph(graph).catch(loggedFallback("knowledge index update", undefined));
          return report;
        },
      };
    },
    rootId: () => base,
    async showGraph(rootId, focus) {
      const url = knowledgeSurfaceUrl(deps.linked.projectId);
      const named = focus.length > 0 ? ` It opens on the project's board; search for the ${focus.length} file(s) named here.` : "";
      return { text: `The knowledge graph of **${rootId}** is on the project's canvas: [Open the knowledge graph](${url}).${named}` };
    },
  };
}

/** The on-prem port with the knowledge rows merged in, when the host is linked to a project. */
export function withOnPremKnowledgeRows(port: PrefetchPort, deps: Omit<OnPremKnowledgeDeps, "linked">): PrefetchPort {
  const linked = onPremKnowledgeClient();
  if (!linked) return port;
  return withKnowledgeRows(port, onPremKnowledgeRowsHost({ ...deps, linked }), defineRegistry);
}
