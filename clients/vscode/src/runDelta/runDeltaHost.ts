/**
 * The editor's adapters for the run delta (PRD 41 §C14, VSIX row): where a repository's pre-images, knowledge facts and git
 * come from, the stat-manifest hint for the baseline's fingerprints, and `delta.computed`. The composition root
 * (`brainRunHostPorts.ts`, through `editorRunDelta.ts`) assembles these; the delta itself (`finalizeRunDelta.ts`) and the
 * baseline (`runChangeBaseline.ts`) only see the ports.
 *
 * A repository's knowledge file is a WORKSPACE FOLDER's (`folderKnowledge`, one connection per folder, shared with the
 * knowledge view), chosen by ONE rule for capture, read and release (`repoPlacement.ts`): the folder holding the repository,
 * else the folder the repository holds (a monorepo subfolder opened on its own). Outside every folder: none — nothing is
 * written outside the workspace. Nothing here throws into a run: a store that cannot open (an older Node without
 * `node:sqlite`, a newer-format file) leaves pre-images and facts absent.
 *
 * Pre-image writes are not awaited by the run start (`runChangeBaseline.ts`): each run's writes are tracked here, and its
 * reads and its release wait for them.
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
import { rootForPath, type KnowledgeRoot } from "../knowledge/knowledgeRoots";
import { rootModules } from "../knowledge/rootModules";
import type { ModuleAliases } from "@builderforce/agent-tools/knowledge";
import { repoModulesRoot } from "./repoModules";
import { emitProductEvent } from "../telemetry/productEvents";
import type { PreimageSink, StatHashHint } from "../runChangeBaseline";
import type { DeltaComputedEvent, RepoHostSources } from "./finalizeRunDelta";
import { repoGit } from "./gitSide";
import * as vscodeApi from "vscode";
import { currentCapabilityInputs } from "../capabilityContext";
import { networkDenied } from "../capabilityStates";
import { queueL3Task } from "../knowledge/l3Tasks";
import { osvDatabaseDir } from "./analyzers/analyzerStorage";
import { analyzeRepo } from "./analyzers/repoAnalyzers";
import type { L3Scheduler } from "./finalizeRunDelta";
import { placeRepo, type RepoPlacement } from "./repoPlacement";
import { predictionShownEvent } from "./runDeltaPredictions";
import type { PreimageReader } from "./sideTexts";
import type { Prediction } from "@builderforce/run-delta/predict";

const HEX64 = /^[0-9a-f]{64}$/;

const placementOf = (repoRoot: string): RepoPlacement | undefined => placeRepo(repoRoot, workspaceFolders().map((f) => f.path));

const persistenceOf = (folder: string) => folderKnowledge(folder).persistence;

/** Each run's pre-image writes still in flight. */
const pendingWrites = new Map<string, Set<Promise<unknown>>>();
/** The folders each run wrote pre-images to (what {@link releaseRun} unpins). */
const writtenFolders = new Map<string, Set<string>>();

/** Resolves when every pre-image write of `runId` so far has settled. */
async function writesSettled(runId: string): Promise<void> {
  await Promise.allSettled([...(pendingWrites.get(runId) ?? [])]);
}

/** The baseline's pre-image sink for one run: each repository's bytes into its folder's knowledge file, pinned to the run. */
export function preimageSinkFor(runId: string): PreimageSink {
  return (root, items) => {
    const placement = placementOf(root);
    if (!placement) return Promise.resolve();
    const write = putPreimages(persistenceOf(placement.folder), runId, items, Date.now());
    writtenFolders.set(runId, (writtenFolders.get(runId) ?? new Set<string>()).add(placement.folder));
    const set = pendingWrites.get(runId) ?? new Set<Promise<unknown>>();
    pendingWrites.set(runId, set);
    set.add(write);
    void write.finally(() => set.delete(write)).catch(() => undefined);
    return write;
  };
}

/**
 * The stat-manifest hint for one run's fingerprints: a file's stored hash when its stat matches its row in the workspace
 * folder's `stat` table (and it is not racy), loaded once per folder per run. Never throws.
 */
export function statHashHint(): StatHashHint {
  const sets = new Map<string, Promise<{ rootId: string; set: StatSet } | undefined>>();
  return async (absPath, st) => {
    const folder = rootForPath(absPath, workspaceFolders())?.folderPath;
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
 * A repository's knowledge root, opened for the delta (the knowledge view's own store and manifest): its placement folder's
 * root — the one a review indexes — with the repository's place relative to it.
 */
/** The repository's own aliases when it is not the knowledge folder itself (`repoModules.ts`), else the folder's. */
async function sideAliases(kroot: KnowledgeRoot, placement: RepoPlacement, repoRoot: string, folderAliases: ModuleAliases): Promise<ModuleAliases> {
  const repo = repoModulesRoot(placement, repoRoot, kroot);
  return repo ? (await rootModules(repo)).aliases : folderAliases;
}

async function knowledgeOf(secrets: vscode.SecretStorage, placement: RepoPlacement, repoRoot: string): Promise<RepoHostSources["knowledge"]> {
  const kroot = rootForPath(placement.folder, workspaceFolders());
  if (!kroot) return undefined;
  const open = openRoot(secrets, kroot);
  await open.migrated;
  const partitions = await readPartitions({ caps: buildLocalCapabilityProvider(kroot.folderPath) });
  const persistence = persistenceOf(kroot.folderPath);
  const modules = await rootModules(kroot);
  return {
    rootId: kroot.rootId, placement, store: open.local, manifest: open.manifest, packs: reviewPacks({ partitions, modules }),
    generation: () => persistence.getMeta("generation") ?? "0",
    // The sides' FileFacts are in REPO space: they resolve with the repository's own aliases (a nested repo's tsconfig paths).
    aliases: await sideAliases(kroot, placement, repoRoot, modules.aliases),
  };
}

/**
 * One run's pre-image reader in a repository's knowledge file (bytes by content hash, after the run's writes settle), or
 * undefined outside every workspace folder. A released run's rows stay readable for the retention (`PREIMAGE_RETENTION_MS`).
 */
export function preimageReaderFor(runId: string, root: string): PreimageReader | undefined {
  const placement = placementOf(root);
  if (!placement) return undefined;
  const db = persistenceOf(placement.folder);
  return async (hashes) => { await writesSettled(runId); return readPreimages(db, hashes); };
}

/** The naturalness kill switch (`builderforce.runDelta.predict.naturalness`, PRD 41 §D6), for the repository's folder. */
export const NATURALNESS_SETTING = "runDelta.predict.naturalness";
export const naturalnessEnabled = (root: string): boolean =>
  vscodeApi.workspace.getConfiguration("builderforce", vscodeApi.Uri.file(root)).get<boolean>(NATURALNESS_SETTING, true) !== false;

/** Everything one repository root offers one run's delta, each part degrading on its own. */
export function editorDeltaSources(
  secrets: vscode.SecretStorage, log: (what: string, error: unknown) => void, runId: string,
): (root: string) => Promise<RepoHostSources> {
  return async (root) => {
    const placement = placementOf(root);
    let preimages: RepoHostSources["preimages"];
    try {
      const read = preimageReaderFor(runId, root);
      if (read) preimages = { read };
    } catch (error) {
      log("pre-image store", error);
    }
    const knowledge = placement ? await knowledgeOf(secrets, placement, root).catch((error: unknown) => { log("knowledge facts", error); return undefined; }) : undefined;
    return { git: repoGit(root), ...(preimages ? { preimages } : {}), ...(knowledge ? { knowledge } : {}) };
  };
}

/** Releases a run's pre-image pins in a repository's knowledge file (after its writes settle) and sweeps expired rows. */
export async function releasePreimages(root: string, runId: string): Promise<void> {
  await writesSettled(runId);
  pendingWrites.delete(runId);
  writtenFolders.delete(runId);
  const placement = placementOf(root);
  if (!placement) return;
  const db = persistenceOf(placement.folder);
  await unpinPreimages(db, runId, Date.now());
  await sweepPreimages(db, Date.now());
}

/** Releases every pin of a run whose change set was never finalized here (`BaselineCaptureOptions.release`). */
export async function releaseRun(runId: string): Promise<void> {
  await writesSettled(runId);
  pendingWrites.delete(runId);
  const folders = writtenFolders.get(runId) ?? new Set<string>();
  writtenFolders.delete(runId);
  for (const folder of folders) await unpinPreimages(persistenceOf(folder), runId, Date.now());
}

/** `delta.computed`: logged, and sent through the editor's named product-event channel (`telemetry/productEvents.ts`). */
export function deltaTelemetry(log: (line: string) => void): (event: DeltaComputedEvent) => void {
  return (event) => {
    log(`[telemetry] ${event.name} ${JSON.stringify(event)}`);
    emitProductEvent(event.name, { ...event });
  };
}

/**
 * `prediction.shown` (PRD 41 §4): called by the surface that renders a prediction (the card's Predicted block), once per
 * rendered prediction. Only an `ok`, non-zero prediction is ever rendered, so only that one is counted.
 */
export function predictionShown(prediction: Prediction): void {
  if (prediction.status !== "ok" || !(prediction.value > 0)) return;
  const event = predictionShownEvent(prediction);
  emitProductEvent(event.name, { ...event });
}

/**
 * The L3 analyzer tier (PRD 41 §B7, §6 step 4) as phase 2 of the delta: the bundled and present tools on both sides —
 * none in an untrusted workspace (`skipped` / `untrusted-workspace`) — queued on the background indexer's L3 gate. The
 * offline vulnerability database lives in the extension's storage and is refreshed only while the network is allowed.
 */
export const deltaL3: L3Scheduler = {
  analyze: (root, prepared, signal) => {
    const dbDir = osvDatabaseDir();
    return analyzeRepo(root, prepared, {
      trusted: () => vscodeApi.workspace.isTrusted,
      codeql: vscodeApi.workspace.getConfiguration("builderforce", vscodeApi.Uri.file(root)).get<boolean>("runDelta.analyzers.codeql", false) === true,
      ...(dbDir ? { osv: { dbDir, download: !networkDenied(currentCapabilityInputs()) } } : {}),
    }, signal);
  },
  queue: (root, run) => queueL3Task({ root, run }),
};

/** The optional dynamic tier of one repository (PRD 41 C6.2/C8.4; `dynamicTierHost.ts`). */
export { deltaDynamicTier } from "./dynamicTierHost";
