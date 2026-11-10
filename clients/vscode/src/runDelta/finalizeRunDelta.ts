/**
 * THE run delta at run finalization (PRD 41 §6 "Agent run", §C14): for each change set a run committed, the engine's
 * `computeRunDelta` over this host's ports, stored as a `run-delta` record, posted to the chat as `run-delta/card`, and
 * counted as `delta.computed`.
 *
 * It must never fail or delay the run's own result: {@link startRunDelta} is called from the change set's `onFinalized`
 * (after the run settled, never awaited), catches everything into `onError`, and abandons a computation that outlives its
 * budget — that delta is then simply absent (nothing is stored or posted late).
 *
 * The registry is the built-in one merged with the repository's `.builderforce/delta.json` AS OF THE BASELINE
 * ({@link DELTA_OVERRIDES_PATH}). The run's `kind` is left unset: nothing a host start carries says a run is a consolidation.
 *
 * POLICY (§12.5). An autonomous run whose delta has blocking findings is recorded `blocked` with their rule ids. There is no
 * finalize gate to refuse in this host: an audit run's completion is written DURING the run by the agent's findings tool
 * (`saveLocalAuditFindings`), and `markLocalAuditRun` never moves a completed run. The flag is what a gate will read.
 *
 * Pre-images: the run's hold on them is released once its deltas are settled (recorded or failed), and expired rows are
 * swept, in each repository's knowledge file (`deps.release`). A run that never finalizes (a crash, a closed editor) has its
 * pins expire after the retention (`sweepPreimages`).
 */

import { computeRunDelta, defaultDimensionRegistry, DEFAULT_REGISTRIES, withOverrides, type RunDelta } from "@builderforce/run-delta";
import type { EntityDestination, LocalFirstStore } from "@builderforce/local-first";
import { normalizePath } from "../gitChangeModel";
import { fingerprintHash, type ChangeSetRepoBaseline } from "../runChangeBaseline";
import type { FinalizedRunChangeSets, LocalChangeSetValue } from "../runChangeSets";
import { deltaAttribution, parallelClaims } from "./attribution";
import { headSwitched, type RepoGit } from "./gitSide";
import { runDeltaPorts } from "./runDeltaPorts";
import { cardOf, pastBlastScores, storeRunDelta, type RunDeltaCard, type RunDeltaRecordValue } from "./runDeltaRecords";
import type { KnowledgeContext } from "./sideFacts";
import { SideTexts, type PreimageReader } from "./sideTexts";

/** The budget a run's deltas get before they are abandoned (the static tier's p95 target is 10 s for ≤ 50 files). */
export const RUN_DELTA_BUDGET_MS = 30_000;

/** What one repository root offers the delta. Every member is optional: a missing one degrades that part, never the run. */
export interface RepoHostSources {
  git?: RepoGit;
  preimages?: { read: PreimageReader };
  knowledge?: KnowledgeContext;
}

/** The repository's delta overrides, read from the BEFORE side only. */
export const DELTA_OVERRIDES_PATH = ".builderforce/delta.json";

/** `delta.computed` (PRD 41 §4 telemetry): counts and the headline, never content. */
export interface DeltaComputedEvent {
  name: "delta.computed";
  surface: "vscode";
  mode: "interactive" | "autonomous";
  headline: RunDelta["headline"];
  ms: number;
  files: number;
  excluded: number;
  introduced: number;
  resolved: number;
  blocking: number;
}

export interface RunDeltaDeps {
  store: LocalFirstStore;
  /**
   * Releases the run's pre-image pins in one repository's knowledge file and sweeps expired rows — its own light handle, so
   * a release never waits on (or fails with) the knowledge sources.
   */
  release?(root: string, runId: string): Promise<void>;
  /** The local device id (read when a record is written). */
  deviceId(): string;
  destination?: EntityDestination;
  sources(root: string): Promise<RepoHostSources>;
  /** Hands a stored delta to the chat (`run-delta/card`). */
  post(card: RunDeltaCard): void;
  telemetry(event: DeltaComputedEvent): void;
  onError(error: unknown): void;
  now?: () => Date;
  /** Default {@link RUN_DELTA_BUDGET_MS}. */
  budgetMs?: number;
}

export interface RunDeltaRun {
  chatId: number;
  mode: "interactive" | "autonomous";
  closed: FinalizedRunChangeSets;
}

const nowOf = (deps: Pick<RunDeltaDeps, "now">): Date => deps.now?.() ?? new Date();

function eventOf(value: RunDeltaRecordValue): DeltaComputedEvent {
  const findings = value.delta.dimensions.flatMap((d) => d.findings);
  return {
    name: "delta.computed", surface: "vscode", mode: value.mode, headline: value.delta.headline, ms: value.computedMs,
    files: value.delta.impact.changedFiles.length, excluded: value.delta.excluded.length,
    introduced: findings.filter((f) => f.lineage === "introduced").length,
    resolved: findings.filter((f) => f.lineage === "resolved").length,
    blocking: value.delta.blocking.length,
  };
}

/**
 * The repository's `.builderforce/delta.json` as it was at the run's BASELINE — its pre-image when it was dirty then, else
 * `git show <baseCommit>` — never the working tree after the run: a run must not be able to weaken its own gate.
 * Undefined when there was none (or its before side cannot be read: the built-in registry applies).
 */
async function beforeOverrides(base: Pick<ChangeSetRepoBaseline, "files" | "baseCommit" | "kind">, sources: RepoHostSources): Promise<unknown> {
  let text: string | undefined;
  if (DELTA_OVERRIDES_PATH in base.files) {
    const hash = fingerprintHash(base.files[DELTA_OVERRIDES_PATH]);
    if (!hash) return undefined; // it did not exist at baseline
    const bytes = sources.preimages ? (await sources.preimages.read([hash])).get(hash) : undefined;
    if (!bytes) throw new Error("unreadable:preimage-missing"); // it existed, but its before bytes are gone
    text = new TextDecoder("utf-8").decode(bytes);
  } else if (base.baseCommit && base.kind !== "folder" && sources.git) {
    text = await sources.git.show(base.baseCommit, DELTA_OVERRIDES_PATH);
  }
  return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

async function registryOf(
  base: Pick<ChangeSetRepoBaseline, "files" | "baseCommit" | "kind">, sources: RepoHostSources,
): Promise<{ registry: ReturnType<typeof defaultDimensionRegistry>; dropped: string[] }> {
  let raw: unknown;
  try {
    raw = await beforeOverrides(base, sources);
  } catch (error) {
    const unreadable = error instanceof Error && error.message.startsWith("unreadable:");
    return { registry: defaultDimensionRegistry(), dropped: [unreadable ? error.message : "invalid:json"] };
  }
  const { registries, dropped } = withOverrides(DEFAULT_REGISTRIES, raw);
  return { registry: defaultDimensionRegistry(registries), dropped };
}

/** The delta of ONE committed change set. Undefined when the record is gone. */
async function repoDelta(
  deps: RunDeltaDeps, run: RunDeltaRun, set: { id: string; root: string }, sources: RepoHostSources,
): Promise<RunDeltaRecordValue | undefined> {
  const started = Date.now();
  const record = await deps.store.read((tx) => tx.get<LocalChangeSetValue>("change-set", set.id));
  if (!record) return undefined;
  const cs = record.payload;
  const runId = run.closed.runId;
  const base: Pick<ChangeSetRepoBaseline, "root" | "baseCommit" | "branch" | "files" | "preimageTooLarge" | "kind"> =
    run.closed.baseline.repos.find((r) => normalizePath(r.root) === normalizePath(set.root))
    ?? { root: set.root, files: {}, ...(cs.baseCommit ? { baseCommit: cs.baseCommit } : {}) };
  const claims = await parallelClaims(deps.store, { runId, repository: cs.repository, since: run.closed.baseline.capturedAt });
  const texts = new SideTexts(base, sources.git, sources.preimages?.read);
  const inputs = await texts.inputs(cs.files.map((f) => ({ ...f, attribution: deltaAttribution(f, claims) })));
  const switched = sources.git && base.kind !== "folder" ? await headSwitched(sources.git, base) : false;
  const { registry, dropped } = await registryOf(base, sources);
  const delta = await computeRunDelta(
    { runId, mode: run.mode, ...(base.baseCommit ? { baseCommit: base.baseCommit } : {}), ...(switched ? { headSwitched: true } : {}), files: inputs },
    registry,
    runDeltaPorts({
      root: set.root, texts, inputs, ...(sources.knowledge ? { knowledge: sources.knowledge } : {}), ...(sources.git ? { git: sources.git } : {}),
      pastScores: () => pastBlastScores(deps.store, cs.repository),
      onError: deps.onError,
    }),
  );
  return {
    runId, repository: cs.repository, root: set.root, changeSetId: set.id, chatId: run.chatId, mode: run.mode, delta,
    computedMs: Date.now() - started,
    ...(run.mode === "autonomous" && delta.blocking.length > 0 ? { blocked: { rules: [...delta.blocking] } } : {}),
    ...(dropped.length > 0 ? { overridesDropped: dropped } : {}),
  };
}

/**
 * Computes, stores and posts the run's deltas, one per committed change set. `live()` false (the budget ran out) stops it
 * from storing or posting anything further. Returns the cards it stored.
 */
export async function finalizeRunDelta(deps: RunDeltaDeps, run: RunDeltaRun, live: () => boolean = () => true): Promise<RunDeltaCard[]> {
  const cards: RunDeltaCard[] = [];
  const roots = new Map<string, string>();
  for (const r of run.closed.baseline.repos) roots.set(normalizePath(r.root), r.root);
  for (const s of run.closed.committed) roots.set(normalizePath(s.root), s.root);
  const opened = new Map<string, RepoHostSources>();
  const sourcesOf = async (root: string): Promise<RepoHostSources> => {
    const key = normalizePath(root);
    let held = opened.get(key);
    if (!held) opened.set(key, (held = await deps.sources(root).catch((error: unknown) => (deps.onError(error), {}))));
    return held;
  };
  try {
    for (const set of run.closed.committed) {
      try {
        const value = await repoDelta(deps, run, set, await sourcesOf(set.root));
        if (!value || !live()) continue;
        const stored = await storeRunDelta(deps.store, { deviceId: deps.deviceId(), at: nowOf(deps).toISOString(), ...(deps.destination ? { destination: deps.destination } : {}) }, value, live);
        if (!stored || !live()) continue;
        const card = cardOf(value);
        cards.push(card);
        deps.post(card);
        deps.telemetry(eventOf(value));
      } catch (error) {
        deps.onError(error); // this repository's delta is absent; the others still run
      }
    }
  } finally {
    for (const root of roots.values()) await deps.release?.(root, run.closed.runId).catch(deps.onError);
  }
  return cards;
}

/**
 * {@link finalizeRunDelta}, bounded and detached: never rejects, and past `budgetMs` it is abandoned (logged through
 * `onError`); nothing is stored or posted after that. The promise is for tests and shutdown; the run never waits on it.
 */
export function startRunDelta(deps: RunDeltaDeps, run: RunDeltaRun): Promise<void> {
  let live = true;
  const budget = deps.budgetMs ?? RUN_DELTA_BUDGET_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      live = false;
      deps.onError(new Error(`run_delta_budget: the delta of run ${run.closed.runId} took longer than ${budget} ms and was abandoned`));
      resolve();
    }, budget);
  });
  const work = finalizeRunDelta(deps, run, () => live).then(() => undefined, (error: unknown) => deps.onError(error));
  return Promise.race([work, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}
