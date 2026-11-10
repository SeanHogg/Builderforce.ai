/**
 * THE run delta at run finalization (PRD 41 §6 "Agent run", §C14): for each change set a run committed, the engine's
 * `computeRunDelta` over this host's ports, stored as a `run-delta` record, posted to the chat as `run-delta/card`, and
 * counted as `delta.computed`.
 *
 * It must never fail the run: {@link startRunDelta} is called from the change set's `onFinalized` (after the run settled,
 * never awaited), catches everything into `onError`, and abandons a computation that outlives its budget — that delta is
 * then simply absent (nothing is stored or posted late). Only an autonomous run's terminal status waits for it, through the
 * finalize gate (below).
 *
 * The registry is the built-in one merged with the repository's `.builderforce/delta.json` AS OF THE BASELINE (the engine's
 * `DELTA_CONFIG_PATH`; a change to it within the run is the engine's own blocking `delta-config-changed`). The run's `kind`
 * is left unset: nothing a host start carries says a run is a consolidation.
 *
 * The inputs are gathered on this thread (`runDeltaPorts.ts`); the engine runs in a worker (`deltaWorkerHost.ts`) that the
 * budget terminates.
 *
 * POLICY (§12.5). An autonomous run carries a {@link RunHoldPort} (`runHoldGate.ts`): the run host holds back its terminal
 * status until its deltas settle (within the budget), and a delta's blocking codes, reported through `block`, hold the run
 * (`awaiting_input` with those rule ids) instead of letting it complete. The record's `blocked` is exactly what the gate
 * accepted: absent for an interactive run, and for codes computed after the verdict was given.
 *
 * Pre-images: the run's hold on them is released once its deltas are settled (recorded or failed), and expired rows are
 * swept, in each repository's knowledge file (`deps.release`). A run that never finalizes (a crash, a closed editor) has its
 * pins expire after the retention (`sweepPreimages`).
 */

import { DEFAULT_REGISTRIES, DELTA_CONFIG_PATH, withOverrides, type DeltaRegistries, type RunDelta } from "@builderforce/run-delta";
import type { EntityDestination, LocalFirstStore } from "@builderforce/local-first";
import { normalizePath } from "../gitChangeModel";
import { fingerprintHash, type ChangeSetRepoBaseline } from "../runChangeBaseline";
import type { FinalizedRunChangeSets, LocalChangeSetValue } from "../runChangeSets";
import { deltaAttribution, overlappingRun, writesInRepo } from "./attribution";
import { computeInWorker } from "./deltaWorkerHost";
import { headSwitched, type RepoGit } from "./gitSide";
import { prepareDelta } from "./runDeltaPorts";
import type { RunHoldPort } from "./runHoldGate";
import {
  cardOf, pastBlastScores, redactDropped, storeRunDelta, syncedRepository, type RunDeltaCard, type StoredRunDelta,
} from "./runDeltaRecords";
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
  /**
   * The run's own write evidence: the paths its file tools created, edited or deleted (its recorded tool calls), as the tools
   * named them. Undefined: none recorded (attribution falls back to the overlap rule alone).
   */
  writes?: readonly string[];
  /** The folder the tools resolve a relative path against. */
  workspaceRoot?: string;
  /** An autonomous run's finalize gate (§12.5). Absent: nothing this run's delta computes can hold it. */
  hold?: RunHoldPort;
}

const nowOf = (deps: Pick<RunDeltaDeps, "now">): Date => deps.now?.() ?? new Date();

function eventOf({ value }: StoredRunDelta): DeltaComputedEvent {
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
  if (DELTA_CONFIG_PATH in base.files) {
    const hash = fingerprintHash(base.files[DELTA_CONFIG_PATH]);
    if (!hash) return undefined; // it did not exist at baseline
    const bytes = sources.preimages ? (await sources.preimages.read([hash])).get(hash) : undefined;
    if (!bytes) throw new Error("unreadable:preimage-missing"); // it existed, but its before bytes are gone
    text = new TextDecoder("utf-8").decode(bytes);
  } else if (base.baseCommit && base.kind !== "folder" && sources.git) {
    const blobs = await sources.git.blobs(base.baseCommit, [DELTA_CONFIG_PATH]);
    if (blobs === undefined) throw new Error("unreadable:git-unavailable");
    const bytes = blobs.get(DELTA_CONFIG_PATH);
    text = bytes ? new TextDecoder("utf-8").decode(bytes) : undefined;
  }
  return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

async function registriesOf(
  base: Pick<ChangeSetRepoBaseline, "files" | "baseCommit" | "kind">, sources: RepoHostSources,
): Promise<{ registries: DeltaRegistries; dropped: string[] }> {
  let raw: unknown;
  try {
    raw = await beforeOverrides(base, sources);
  } catch (error) {
    const unreadable = error instanceof Error && error.message.startsWith("unreadable:");
    return { registries: DEFAULT_REGISTRIES, dropped: [unreadable ? error.message : "invalid:json"] };
  }
  return withOverrides(DEFAULT_REGISTRIES, raw);
}

/** The delta of ONE committed change set. Undefined when the record is gone. */
async function repoDelta(
  deps: RunDeltaDeps, run: RunDeltaRun, set: { id: string; root: string }, sources: RepoHostSources, signal: AbortSignal,
): Promise<StoredRunDelta | undefined> {
  const started = Date.now();
  const record = await deps.store.read((tx) => tx.get<LocalChangeSetValue>("change-set", set.id));
  if (!record) return undefined;
  const cs = record.payload;
  const runId = run.closed.runId;
  const base: Pick<ChangeSetRepoBaseline, "root" | "baseCommit" | "branch" | "files" | "preimageTooLarge" | "kind"> =
    run.closed.baseline.repos.find((r) => normalizePath(r.root) === normalizePath(set.root))
    ?? { root: set.root, files: {}, ...(cs.baseCommit ? { baseCommit: cs.baseCommit } : {}) };
  const repository = syncedRepository(cs.repository);
  const overlap = await overlappingRun(deps.store, {
    runId, repository: cs.repository, since: run.closed.baseline.capturedAt, until: nowOf(deps).toISOString(),
  });
  const writes = run.writes ? writesInRepo(run.writes, set.root, run.workspaceRoot) : undefined;
  const texts = new SideTexts(base, sources.git, sources.preimages?.read);
  const files = await texts.inputs(cs.files.map((f) => ({ ...f, attribution: deltaAttribution(f, { overlap, ...(writes ? { writes } : {}) }) })));
  const switched = sources.git && base.kind !== "folder" ? await headSwitched(sources.git, base) : false;
  const { registries, dropped } = await registriesOf(base, sources);
  const prepared = await prepareDelta({
    root: set.root, texts, registries,
    input: { runId, mode: run.mode, ...(base.baseCommit ? { baseCommit: base.baseCommit } : {}), ...(switched ? { headSwitched: true } : {}), files },
    ...(sources.knowledge ? { knowledge: sources.knowledge } : {}), ...(sources.git ? { git: sources.git } : {}),
    pastScores: () => pastBlastScores(deps.store, repository),
    onError: deps.onError,
  });
  const delta = await computeInWorker(prepared, signal);
  // Reported as soon as computed, before the store: a computed blocking code holds the run even if its record is late.
  const held = delta.blocking.length > 0 && run.hold?.block(delta.blocking) === true;
  return {
    value: {
      runId, repository, changeSetId: set.id, chatId: run.chatId, mode: run.mode, delta,
      computedMs: Date.now() - started,
      ...(held ? { blocked: { rules: [...delta.blocking] } } : {}),
      ...(dropped.length > 0 ? { overridesDropped: redactDropped(dropped) } : {}),
    },
    local: { kind: "local", runId, chatId: run.chatId, root: set.root, repo: cs.repository },
  };
}

/**
 * Computes, stores and posts the run's deltas, one per committed change set. `live()` false (the budget ran out) stops it
 * from storing or posting anything further. Returns the cards it stored.
 */
export async function finalizeRunDelta(
  deps: RunDeltaDeps, run: RunDeltaRun, live: () => boolean = () => true, signal: AbortSignal = new AbortController().signal,
): Promise<RunDeltaCard[]> {
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
        const value = await repoDelta(deps, run, set, await sourcesOf(set.root), signal);
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
 * `onError`); nothing is stored or posted after that. Either way the run's hold port is then told it settled. The promise
 * is for tests and shutdown; the run never waits on it (an autonomous run's terminal status waits on the gate instead).
 */
export function startRunDelta(deps: RunDeltaDeps, run: RunDeltaRun): Promise<void> {
  let live = true;
  const budget = deps.budgetMs ?? RUN_DELTA_BUDGET_MS;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      live = false;
      abort.abort(); // terminates the engine's worker
      deps.onError(new Error(`run_delta_budget: the delta of run ${run.closed.runId} took longer than ${budget} ms and was abandoned`));
      resolve();
    }, budget);
  });
  const work = finalizeRunDelta(deps, run, () => live, abort.signal).then(() => undefined, (error: unknown) => deps.onError(error));
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
    run.hold?.settled();
  });
}
