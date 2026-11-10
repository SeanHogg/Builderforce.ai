/**
 * The editor's adapters for the run delta (PRD 41 §C14, VSIX row): where a repository's pre-images, knowledge facts and git
 * come from, the stat-manifest hint for the baseline's fingerprints, and `delta.computed`. The composition root
 * (`brainRunHostPorts.ts`) assembles these; the delta itself (`finalizeRunDelta.ts`) and the baseline (`runChangeBaseline.ts`)
 * only see the ports.
 *
 * A repository's knowledge file is its WORKSPACE FOLDER's (`folderKnowledge`, one connection per folder, shared with the
 * knowledge view); a repository outside every folder uses its own root's file. Nothing here throws into a run: a store that
 * cannot open (an older Node without `node:sqlite`, a newer-format file) leaves pre-images and facts absent.
 */

import * as path from "node:path";
import type * as vscode from "vscode";
import { reusedHash, reviewPacks } from "@builderforce/agent-tools/knowledge";
import { readPartitions } from "@builderforce/agent-tools/prefetch";
import { putPreimages, readPreimages, sweepPreimages, unpinPreimages } from "@builderforce/agent-tools/node-knowledge-store";
import { CONTENT_HASH_RULE } from "@seanhogg/builderforce-memory/knowledge";
import type { StatSet } from "@builderforce/agent-tools/knowledge";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { folderKnowledge } from "../knowledge/folderKnowledge";
import { openRoot, workspaceFolders } from "../knowledge/knowledgeService";
import { rootForPath } from "../knowledge/knowledgeRoots";
import type { PreimageSink, StatHashHint } from "../runChangeBaseline";
import type { DeltaComputedEvent, RepoHostSources } from "./finalizeRunDelta";
import { repoGit } from "./gitSide";

const HEX64 = /^[0-9a-f]{64}$/;

/** The workspace folder holding `abs` (the innermost): whose knowledge file a repository uses. Outside every folder: none. */
function folderOf(abs: string): string | undefined {
  return rootForPath(abs, workspaceFolders())?.folderPath;
}

const persistenceOf = (folder: string) => folderKnowledge(folder).persistence;

/** The baseline's pre-image sink for one run: each repository's bytes into its folder's knowledge file, pinned to the run. */
export function preimageSinkFor(runId: string): PreimageSink {
  return async (root, items) => {
    const folder = folderOf(root);
    if (folder) await putPreimages(persistenceOf(folder), runId, items, Date.now());
  };
}

/**
 * The stat-manifest hint for one run's fingerprints: a file's stored hash when its stat matches its row in the workspace
 * folder's `stat` table (and it is not racy), loaded once per folder per run. Never throws.
 */
export function statHashHint(): StatHashHint {
  const sets = new Map<string, Promise<{ rootId: string; set: StatSet } | undefined>>();
  return async (absPath, st) => {
    const folder = folderOf(absPath);
    const root = folder ? rootForPath(folder, workspaceFolders()) : undefined;
    if (!root) return undefined;
    let held = sets.get(root.folderPath);
    if (!held) {
      held = folderKnowledge(root.folderPath).hashCache.load(root.rootId, CONTENT_HASH_RULE)
        .then((set) => ({ rootId: root.rootId, set }), () => undefined);
      sets.set(root.folderPath, held);
    }
    const loaded = await held;
    if (!loaded) return undefined;
    const rel = path.relative(root.folderPath, absPath).split(path.sep).join("/");
    const hash = reusedHash(st, loaded.set.rows.get(rel), loaded.set, undefined);
    return hash && HEX64.test(hash) ? hash : undefined;
  };
}

/**
 * A repository's knowledge root, opened for the delta (the knowledge view's own store and manifest): the WORKSPACE FOLDER's
 * root — the one a review indexes — with the repository's place in it as the path prefix. A repository that is not inside a
 * workspace folder (a folder opened below its root) has no facts.
 */
async function knowledgeOf(secrets: vscode.SecretStorage, root: string): Promise<RepoHostSources["knowledge"]> {
  const folder = folderOf(root);
  const kroot = folder ? rootForPath(folder, workspaceFolders()) : undefined;
  if (!folder || !kroot) return undefined;
  const rel = path.relative(folder, root).split(path.sep).join("/");
  const prefix = rel ? `${rel}/` : "";
  const open = openRoot(secrets, kroot);
  await open.migrated;
  const partitions = await readPartitions({ caps: buildLocalCapabilityProvider(kroot.folderPath) });
  const persistence = persistenceOf(kroot.folderPath);
  return {
    rootId: kroot.rootId, prefix, store: open.local, manifest: open.manifest, packs: reviewPacks({ partitions }),
    generation: () => persistence.getMeta("generation") ?? "0",
  };
}

/** Everything one repository root offers the delta, each part degrading on its own. */
export function editorDeltaSources(secrets: vscode.SecretStorage, log: (what: string, error: unknown) => void): (root: string) => Promise<RepoHostSources> {
  return async (root) => {
    let preimages: RepoHostSources["preimages"];
    try {
      const folder = folderOf(root);
      if (folder) {
        const db = persistenceOf(folder);
        preimages = { read: (hashes) => readPreimages(db, hashes) };
      }
    } catch (error) {
      log("pre-image store", error);
    }
    const knowledge = await knowledgeOf(secrets, root).catch((error: unknown) => { log("knowledge facts", error); return undefined; });
    return { git: repoGit(root), ...(preimages ? { preimages } : {}), ...(knowledge ? { knowledge } : {}) };
  };
}

/** Releases a run's pre-image pins in a repository's knowledge file and sweeps expired rows (`RunDeltaDeps.release`). */
export async function releasePreimages(root: string, runId: string): Promise<void> {
  const folder = folderOf(root);
  if (!folder) return;
  const db = persistenceOf(folder);
  await unpinPreimages(db, runId, Date.now());
  await sweepPreimages(db, Date.now());
}

/** `delta.computed`: the VSIX has no named-event telemetry channel (its activity signals are billable time), so it is logged. */
export function deltaTelemetry(log: (line: string) => void): (event: DeltaComputedEvent) => void {
  return (event) => log(`[telemetry] ${event.name} ${JSON.stringify(event)}`);
}
