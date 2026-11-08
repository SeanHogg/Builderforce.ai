/**
 * The `changeset:` reader (PRD 41 Part C). `runChangeSets.ts` writes two kinds of
 * immutable `change-set` record and nothing reads them yet; this module does.
 *
 *   • `changeset:<runId>:<repoKey>` — one per touched repository, the attributed
 *     per-file diff of one run (see {@link LocalChangeSetValue}).
 *   • `changeset-lifecycle:<runId>` — the restart boundary: a content hash of the
 *     baseline plus, once the set closes, `finalizedAt` and the change-set ids.
 *
 * Reads are pure: the caller supplies the {@link LocalFirstStore} and this module
 * never writes, never fetches, never applies a change set. Records are written
 * once and never overwritten, so a reader result is a stable snapshot of one
 * run's evidence. Views are caller-owned copies built inside the scan.
 *
 * Roots are NOT carried on the per-repo record; they live in the lifecycle
 * baseline (`baseline.repos[].root`). `listChangeSetsForRoot` therefore matches
 * through the lifecycle rows first, then collects that run's change-set records.
 */

import {
  destinationKey,
  type LocalFirstStore,
  type LocalRecord,
} from "@builderforce/local-first";
import { normalizePath } from "./gitChangeModel";
import {
  changeSetCompleteness,
  readChangeSetLifecycle,
  type ChangeSetLifecycleValue,
} from "./changeSetLifecycle";
import type { ChangeAttribution } from "./runChangeBaseline";
import type { LocalChangeSetValue } from "./runChangeSets";

export type { LocalChangeSetValue } from "./runChangeSets";

/** One file of a change set, exactly as the record carries it. */
export interface ChangeSetFile {
  path: string;
  beforeHash?: string;
  afterHash?: string;
  patchManifestId?: string;
  attribution: ChangeAttribution;
  status: string;
}

/** The per-repo `changeset:<runId>:<repoKey>` record, flattened for readers. */
export interface ChangeSetView {
  id: string;
  runId: string;
  repository: string;
  branch?: string;
  baseCommit?: string;
  files: ChangeSetFile[];
  author: string;
  capturedAt: string;
}

/** A run's lifecycle row plus every change-set record it owns. */
export interface RunChangeSetSummary {
  runId: string;
  phase: ReturnType<typeof changeSetCompleteness>;
  lifecycle?: ChangeSetLifecycleValue;
  changeSets: ChangeSetView[];
}

/** Lifecycle rows also use entity type `change-set`; this excludes them. */
function isChangeSetRecord(
  record: LocalRecord<unknown>,
): record is LocalRecord<LocalChangeSetValue> {
  const payload = record.payload as { kind?: unknown; runId?: unknown; files?: unknown } | null;
  return Boolean(
    payload &&
      typeof payload === "object" &&
      payload.kind !== "lifecycle" &&
      typeof payload.runId === "string" &&
      Array.isArray(payload.files),
  );
}

function viewOf(record: LocalRecord<LocalChangeSetValue>): ChangeSetView {
  const payload = record.payload;
  return {
    id: record.id,
    runId: payload.runId,
    repository: payload.repository,
    ...(payload.branch ? { branch: payload.branch } : {}),
    ...(payload.baseCommit ? { baseCommit: payload.baseCommit } : {}),
    files: payload.files.map((file) => ({
      path: file.path,
      ...(file.beforeHash ? { beforeHash: file.beforeHash } : {}),
      ...(file.afterHash ? { afterHash: file.afterHash } : {}),
      ...(file.patchManifestId ? { patchManifestId: file.patchManifestId } : {}),
      attribution: file.attribution,
      status: file.status,
    })),
    author: payload.author,
    capturedAt: payload.capturedAt,
  };
}

function phaseOf(value: ChangeSetLifecycleValue | undefined): RunChangeSetSummary["phase"] {
  if (!value) return "absent";
  return changeSetCompleteness(value);
}

/** A run's own change-set records, sorted by record id (deterministic order). */
export async function readRunChangeSets(
  store: LocalFirstStore,
  runId: string,
): Promise<ChangeSetView[]> {
  const views: ChangeSetView[] = [];
  await store.read(async (tx) => {
    await tx.scan<LocalChangeSetValue>("change-set", (row) => {
      if (!isChangeSetRecord(row)) return;
      if (row.payload.runId === runId) views.push(viewOf(row));
    });
  });
  return views.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * What a restart or a report needs about one run: the lifecycle row
 * (`partial` | `finished` | `absent`) and its change-set records, sorted by id.
 */
export async function summarizeRunChangeSets(
  store: LocalFirstStore,
  runId: string,
): Promise<RunChangeSetSummary> {
  const lifecycle = await readChangeSetLifecycle(store, runId);
  return {
    runId,
    phase: phaseOf(lifecycle),
    ...(lifecycle ? { lifecycle } : {}),
    changeSets: await readRunChangeSets(store, runId),
  };
}

/**
 * Every change set that touched `root`, newest capture first, ties broken by id.
 * `root` is normalized before comparing so Windows and POSIX spellings match.
 * Runs are matched through their lifecycle baseline's `repos[].root`.
 */
export async function listChangeSetsForRoot(
  store: LocalFirstStore,
  root: string,
): Promise<ChangeSetView[]> {
  const needle = normalizePath(root);
  const runIds = new Set<string>();
  await store.read(async (tx) => {
    await tx.scan<ChangeSetLifecycleValue>("change-set", (row) => {
      if (!isChangeSetLifecycle(row.payload)) return;
      if (row.payload.baseline.repos.some((repo) => normalizePath(repo.root) === needle)) {
        runIds.add(row.payload.runId);
      }
    });
  });
  if (!runIds.size) return [];
  const views: ChangeSetView[] = [];
  await store.read(async (tx) => {
    await tx.scan<LocalChangeSetValue>("change-set", (row) => {
      if (!isChangeSetRecord(row)) return;
      if (runIds.has(row.payload.runId)) views.push(viewOf(row));
    });
  });
  return views.sort(
    (a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.id.localeCompare(b.id),
  );
}

/**
 * Every change-set record headed for `destination`, sorted by record id.
 * Destinations compare by {@link destinationKey}, the same key the sync layer uses.
 */
export async function listChangeSetsForDestination(
  store: LocalFirstStore,
  destination: EntityDestinationLike,
): Promise<ChangeSetView[]> {
  const key = destinationKey(destination);
  const views: ChangeSetView[] = [];
  await store.read(async (tx) => {
    await tx.scan<LocalChangeSetValue>("change-set", (row) => {
      if (!isChangeSetRecord(row)) return;
      if (destinationKey(row.destination) === key) views.push(viewOf(row));
    });
  });
  return views.sort((a, b) => a.id.localeCompare(b.id));
}

type EntityDestinationLike = Parameters<typeof destinationKey>[0];

/** First match wins. Pure: no write, no fetch. */
export async function findChangeSetById(
  store: LocalFirstStore,
  id: string,
): Promise<ChangeSetView | undefined> {
  const record = await store.read((tx) => tx.get<LocalChangeSetValue>("change-set", id));
  if (!record || !isChangeSetRecord(record)) return undefined;
  return viewOf(record);
}
