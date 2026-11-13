/**
 * The ONE place a root's review ports are assembled, in two stages:
 *
 *   plan() — what the confirm chip's count needs: the source, the manifest, the code layers
 *            (partitions) and a yes/no on near-duplicate comparison. It NEVER waits on a run-only
 *            port: a judge still starting its server, a symbol index still warming or a slow git
 *            history cannot keep "Counting files…" up. Whether compare calls are counted comes from
 *            whether a judge is CONFIGURED ({@link judgeConfigured}: a settings read), never from
 *            whether it finished starting, so the chip does not under-count.
 *   full() — everything a run uses (symbols, analyzers, history, judgement, the knowledge index).
 *            Each step has the generous {@link RUN_STEP_MS} safety cap: a port that FAILS fails
 *            the review as it always did (partitions, judgement, history; the symbol and index
 *            ports were already optional), and only a port that never answers is dropped, logged
 *            by name with its elapsed ms.
 *
 * Both stages draw on the same memoised steps, so nothing is set up twice.
 */

import type * as vscode from "vscode";
import {
  claimSimilarity, indexedSymbolLookup, indexedSymbolSource, planKnowledgeReviewDetail, reviewIndexPort, workspaceCodeAnalyzers,
  type FsDirectorySource, type KnowledgeReviewPorts, type ReviewRecorder, type SymbolLookup,
} from "@builderforce/agent-tools/knowledge";
import { gitHistoryPort } from "@builderforce/agent-tools/node-git-history";
import { readPartitions } from "@builderforce/agent-tools/prefetch";
import type { AnalysisSnapshotPayload } from "@builderforce/knowledge-client";
import type { PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import { boundedStep } from "../boundedStep";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { workspaceSymbolIndex } from "../workspaceSymbols";
import { getHostKnowledgeIndex } from "./index/hostKnowledgeIndex";
import { vscodeKnowledgeFs } from "./knowledgeFs";
import { replicaQueueFor } from "./knowledgeReplica";
import { sharedAnalysis } from "./l3SharedAnalysis";
import { workspaceRunner } from "./l3Worker";
import { editorJudgement, judgeConfigured } from "./knowledgeJudgement";
import type { OpenRoot } from "./knowledgeService";

/** Longest the plan waits on a step it needs (the code layers, whether a judge is configured). */
export const PLAN_STEP_MS = 10_000;
/** Safety cap on one run-only setup step (a 16k-file repo's symbol or knowledge index can take a minute). */
export const RUN_STEP_MS = 120_000;
/** A walk logs its running count every this many files, so a slow one is visible in the output channel. */
const WALK_HEARTBEAT_FILES = 2_500;

type Log = (what: string, error: unknown) => void;

/**
 * The root's code analyzers (the bundled ones, through the local shell): the ONE builder a review and the background
 * indexer's L3 pass (PRD 41 B6) share. With a `recorder` the repo graph's edge count is reported to the review's record.
 */
export function rootCodeAnalyzers(args: {
  open: Pick<OpenRoot, "root" | "files" | "pump">;
  caps: ReturnType<typeof buildLocalCapabilityProvider>;
  partitions: FullReviewPorts["partitions"];
  log: Log;
  recorder?: ReviewRecorder;
}): NonNullable<KnowledgeReviewPorts["analyzers"]> {
  const { open, caps, partitions, log, recorder } = args;
  const { root, pump } = open;
  return workspaceCodeAnalyzers({
    caps,
    // The analysis itself (analyzers, repo graph, conversion) runs in the L3 worker, off this thread (`l3Worker.ts`); the
    // repo graph's import-edge count comes back with it, for the review's record (the sync panel's local edges).
    runner: workspaceRunner({
      folderPath: root.folderPath,
      // THE L3 result cache, shared with the run delta (PRD 41 §B7), for a root that is its folder.
      ...(!root.rel ? { l3RootPath: root.rootPath } : {}),
      ...(root.rel ? { path: root.rel } : {}),
      ...(partitions ? { partitions } : {}),
    }, (result) => { if (recorder && result.edges !== undefined) recorder.edges(result.edges); }, sharedAnalysis),
    // The analysis is always kept locally (the review stores its output); linked, its snapshot is queued for the project.
    ...(pump ? {
      upload: async (sha: string, snapshot: unknown) => {
        const queue = replicaQueueFor(root.rootId, open.files);
        await queue.adopt(pump.projectId);
        queue.setAnalysis({ sha, snapshot: snapshot as AnalysisSnapshotPayload });
      },
    } : {}),
    onUploadError: (error) => log("analysis upload", error),
    onWarn: (message) => log("analysis", message),
  });
}

/** The source, counting what its walk lists (logged once per plan, and every {@link WALK_HEARTBEAT_FILES} files). */
function measuredSource(source: FsDirectorySource, onFile: (count: number) => void): FsDirectorySource {
  return {
    ...source,
    async *list() {
      let count = 0;
      for await (const file of source.list()) {
        onFile(++count);
        yield file;
      }
    },
  };
}

export type FullReviewPorts = KnowledgeReviewPorts & { symbolLookup: SymbolLookup };

export interface RootPortsBuilder {
  /** The plan: the count and the walk behind it; waits only for what planning uses. `background`: never starts the run-only ports, counts no compare calls. */
  plan(opts: { force: boolean; background?: boolean }): Promise<PlanDetail>;
  /** The ports a run (and the judge-model read) uses. */
  full(): Promise<FullReviewPorts>;
  /** The ports of a map-only pass (no judge, no `similar`): the background indexer's L1 pass, and with `analyzers` its L3 pass. */
  mapOnly(analyzers: boolean): Promise<FullReviewPorts>;
  /** Run-only ports that never answered within their cap, by name (they were logged and skipped). */
  degraded(): readonly string[];
}

export interface RootPortsDeps {
  secrets: vscode.SecretStorage;
  open: OpenRoot;
  recorder: ReviewRecorder;
  log: Log;
  /** Overrides, for tests. */
  planMs?: number;
  runMs?: number;
}

export function reviewPortsFor(deps: RootPortsDeps): RootPortsBuilder {
  const { secrets, open, recorder, log } = deps;
  const planMs = deps.planMs ?? PLAN_STEP_MS;
  const runMs = deps.runMs ?? RUN_STEP_MS;
  const { root, client } = open;
  const once = <T>(make: () => Promise<T>): (() => Promise<T>) => { let held: Promise<T> | undefined; return () => (held ??= make()); };
  const degraded: string[] = [];
  const onTimeout = (name: string) => (elapsed: number): void => {
    degraded.push(name);
    log(name, `no answer after ${elapsed}ms; this review runs without it`);
  };
  /** A run step: a failure propagates (`swallow` false) or is logged and skipped (`swallow` true); only the cap degrades it. */
  const step = <T>(name: string, work: () => Promise<T>, fallback: T, swallow = false): (() => Promise<T>) =>
    once(() => boundedStep(work, runMs, {
      fallback,
      onTimeout: onTimeout(name),
      ...(swallow ? { onFail: (error: unknown, elapsed: number) => log(name, `failed after ${elapsed}ms: ${error instanceof Error ? error.message : String(error)}`) } : {}),
    }));

  const caps = buildLocalCapabilityProvider(root.folderPath);
  const partitions = step("partitions", () => readPartitions({ caps }), undefined);
  const symbols = step("symbols", () => workspaceSymbolIndex(root.folderPath).filesUnder(root.rel || undefined), [], true);
  const judgement = step("judgement", () => editorJudgement(secrets, client), undefined);
  const history = step("history", () => gitHistoryPort(root.rootPath, { onWarn: (message) => log("history", message) }), undefined);
  const index = step("index", () => getHostKnowledgeIndex(root.rootId), undefined, true);

  /** Everything a run uses except the judge: what a map-only pass (the background indexer's, PRD 41 B6) runs on. */
  const runPorts = async (withAnalyzers: boolean): Promise<FullReviewPorts> => {
    const [parts, syms, hist] = await Promise.all([partitions(), symbols(), history()]);
    return {
      source: open.source,
      store: open.store,
      manifest: open.manifest,
      partitions: parts,
      symbolsOf: indexedSymbolSource(syms, root.rel),
      // The same index hits, as plain data for the extraction pool's jobs (one symbol rule on both paths).
      symbolLookup: indexedSymbolLookup(syms, root.rel),
      ...(withAnalyzers ? { analyzers: rootCodeAnalyzers({ open, caps, partitions: parts, log, recorder }) } : {}),
      ...(hist ? { history: hist } : {}),
      rootFiles: { fs: vscodeKnowledgeFs(), rootPath: root.rootPath },
      onSignalsSkipped: (skipped) => recorder.signals(skipped),
      // After the review the root's graph feeds the knowledge index (the shared runner does it and reports the phase).
      index: reviewIndexPort(() => getHostKnowledgeIndex(root.rootId)),
      // No `platformGraph`: the knowledge index is fed from the LOCAL graph too, so nothing the editor
      // shows or searches depends on the server's version (PRD 41 A7).
      onIndexError: (error) => log("index upsert", error),
      onSystemsError: (error) => log("systems", error),
    };
  };
  const mapWithAnalyzers = once(() => runPorts(true));
  const mapWithoutAnalyzers = once(() => runPorts(false));

  const full = once(async (): Promise<FullReviewPorts> => {
    const [ports, judge, idx] = await Promise.all([mapWithAnalyzers(), judgement(), index()]);
    return {
      ...ports,
      ...(judge ? { judgement: judge } : {}),
      ...(idx ? { similar: claimSimilarity(idx, open.store, root.rootId) } : {}),
    };
  });

  async function plan({ force, background = false }: { force: boolean; background?: boolean }): Promise<PlanDetail> {
    const started = Date.now();
    // The run-only setup starts now, in the background; the plan below does not wait for it. A background plan never
    // starts it: the indexer's passes do not judge, so no judge (no model server) is started for them.
    if (!background) void full().catch(() => undefined);
    const planOnly = <T>(name: string, work: () => Promise<T>, fallback: T): Promise<T> =>
      boundedStep(work, planMs, {
        fallback,
        onTimeout: (elapsed) => log(name, `no answer after ${elapsed}ms; the plan goes on without it`),
        onFail: (error, elapsed) => log(name, `failed after ${elapsed}ms: ${error instanceof Error ? error.message : String(error)}`),
      });
    const [parts, judge] = await Promise.all([
      boundedStep(partitions, planMs, { fallback: undefined, onTimeout: (elapsed) => log("partitions", `no answer after ${elapsed}ms; the plan goes on without them`) }),
      background ? Promise.resolve(false) : planOnly("judge configured", judgeConfigured, false),
    ]);
    const portsMs = Date.now() - started;
    const walkStarted = Date.now();
    let files = 0;
    let walkMs = 0;
    const source = measuredSource(open.source, (count) => {
      files = count;
      walkMs = Date.now() - walkStarted;
      if (count % WALK_HEARTBEAT_FILES === 0) log("plan", `${count} files counted so far (${walkMs}ms)`);
    });
    try {
      const planned = await planKnowledgeReviewDetail(
        { source, store: open.store, manifest: open.manifest, ...(parts ? { partitions: parts } : {}) },
        { force, compare: judge },
      );
      const total = Date.now() - started;
      log("plan", `${root.rootPath}: ${files} files walked in ${walkMs}ms, ports ${portsMs}ms, manifest+diff ${Math.max(0, total - portsMs - walkMs)}ms, total ${total}ms`);
      return planned;
    } catch (error) {
      log("plan failed", `${root.rootPath} after ${Date.now() - started}ms (${files} files walked): ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  return { plan, full, mapOnly: (analyzers) => (analyzers ? mapWithAnalyzers() : mapWithoutAnalyzers()), degraded: () => [...degraded] };
}
