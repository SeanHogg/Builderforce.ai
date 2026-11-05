/**
 * The Knowledge view's sync status (PRD 38, Option B+ Contract 4, `syncStatus`) - pure over
 * ports, so it is tested without an extension host:
 *
 *   local / server   counts of files, edges and docs;
 *   skipped          what the root's LAST review left out (agent-tools `reviewRecord.ts`,
 *                    persisted per root in the workspace state) - absent when no review
 *                    recorded one, which is "unknown", not "none";
 *   sources          each data source and whether it was collected or is not set up.
 *
 * A source that is not set up says `absent`; it never carries an invented number.
 */

import {
  CODEOWNERS_LOCATIONS, coverageSourceState, reviewRecordStore, type KnowledgeFs,
} from "@builderforce/agent-tools/knowledge";
import type { KnowledgeSyncCounts, KnowledgeSyncSkipped, KnowledgeSyncStatus } from "./knowledgeProtocol";

type Source = KnowledgeSyncStatus["sources"][number];

/** Where an OpenAPI description is looked for: the root and these folders directly under it. */
const OPENAPI_FOLDERS = ["", "docs", "api", "spec", "specs", "openapi"];
const OPENAPI_NAMES = ["openapi.json", "openapi.yaml", "openapi.yml", "swagger.json"];

export interface RecordMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

let memento: RecordMemento | undefined;

/** Where review records are persisted (`workspaceState`), set at activation. */
export function useRecordMemento(m: RecordMemento | undefined): void {
  memento = m;
}

/** The ONE record store of this extension host: memory first, the workspace state behind it. */
export const reviewRecords = reviewRecordStore({
  read: (key) => memento?.get(key),
  write: (key, value) => { void Promise.resolve(memento?.update(key, value)).catch(() => undefined); },
});

async function exists(fs: KnowledgeFs, path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

const join = (root: string, rel: string): string => `${root.replace(/[\\/]+$/, "")}/${rel}`;

async function anyExists(fs: KnowledgeFs, rootPath: string, rels: readonly string[]): Promise<boolean> {
  for (const rel of rels) if (await exists(fs, join(rootPath, rel))) return true;
  return false;
}

export interface SyncStatusInput {
  fs: KnowledgeFs;
  rootPath: string;
  local: KnowledgeSyncCounts;
  server?: KnowledgeSyncCounts;
  /** The last review's skipped list; undefined when none was recorded. */
  skipped: readonly KnowledgeSyncSkipped[] | undefined;
  /** True once the root was reviewed (a record exists) or the platform holds its graph. */
  reviewed: boolean;
  /** True when the folder is a git work tree (a `HistoryPort` exists). */
  hasHistory: boolean;
}

export async function buildSyncStatus(input: SyncStatusInput): Promise<KnowledgeSyncStatus> {
  const { fs, rootPath } = input;
  const [coverage, owners, openapi] = await Promise.all([
    coverageSourceState({ fs, rootPath }).catch(() => "absent" as const),
    anyExists(fs, rootPath, CODEOWNERS_LOCATIONS),
    anyExists(fs, rootPath, OPENAPI_FOLDERS.flatMap((folder) => OPENAPI_NAMES.map((name) => (folder ? `${folder}/${name}` : name)))),
  ]);
  const have = (ok: boolean): Source["state"] => (ok ? "collected" : "absent");
  const coverageSkips = (input.skipped ?? []).filter((s) => s.reason.startsWith("coverage-")).length;
  const sources: Source[] = [
    { id: "code", state: have(input.reviewed && (input.server?.files ?? input.local.files) > 0) },
    { id: "docs", state: have(input.reviewed && (input.server?.docs ?? input.local.docs) > 0) },
    { id: "coverage", state: coverage, ...(coverageSkips > 0 ? { note: `${coverageSkips} coverage file(s) skipped (too large or older than their source).` } : {}) },
    { id: "usage", state: "absent", note: "No runtime usage source is connected." },
    { id: "traces", state: "absent", note: "No trace source is connected." },
    { id: "openapi", state: have(openapi) },
    { id: "history", state: have(input.hasHistory) },
    { id: "owners", state: have(owners) },
  ];
  return {
    local: input.local,
    ...(input.server ? { server: input.server } : {}),
    ...(input.skipped ? { skipped: [...input.skipped] } : {}),
    sources,
  };
}
