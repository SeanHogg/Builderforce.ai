/**
 * Versions of a whole IDE project: "Version 5 at 3:40 PM — restore".
 *
 * File history (workspaceStore) keeps every overwritten or deleted file, but a
 * project-wide restore also needs to know what the project WAS at a moment: which
 * files existed and which bytes each held. A checkpoint is exactly that, as a
 * manifest of `{ path, etag }`. It copies no content. The bytes it names are
 * either still current or were archived into history when they were replaced or
 * deleted (equal bytes, equal etag), so restoring is a lookup, not a guess.
 *
 * Manifests live in R2 beside the workspace. What the list view needs (kind,
 * time, a few changed paths, a name) rides in the object's custom metadata, so
 * listing versions is one R2 list call with no per-version reads.
 */
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  listWorkspaceHistory,
  restoreWorkspaceVersion,
} from './workspaceStore';

/** Why a version exists; the UI words it. */
export type CheckpointKind = 'baseline' | 'auto' | 'manual' | 'beforeRestore';
const KINDS: readonly CheckpointKind[] = ['baseline', 'auto', 'manual', 'beforeRestore'];

export interface CheckpointSummary {
  /** Epoch ms; also the id. */
  id: number;
  kind: CheckpointKind;
  /** A person's name for it (manual versions). */
  name?: string;
  /** A few of the files that changed since the previous version (auto versions). */
  changed: string[];
  fileCount: number;
}

export interface RestoreOutcome {
  restored: string[];
  removed: string[];
  /** Files the version names whose bytes are no longer in history (pruned). */
  missing: string[];
}

interface Manifest {
  files: Array<{ path: string; etag: string }>;
}

const MAX_CHECKPOINTS = 60;
const MAX_CHANGED_LISTED = 5;
const MAX_NAME = 80;

const prefix = (projectId: number) => `ide/checkpoints/projects/${projectId}/`;

let lastStamp = 0;
/** Strictly increasing within an isolate, so two versions in one millisecond do not collide. */
function nextStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

export async function createCheckpoint(
  bucket: R2Bucket,
  projectId: number,
  input: { kind: CheckpointKind; name?: string; changed?: string[] },
): Promise<CheckpointSummary> {
  const files = (await listWorkspaceFiles(bucket, projectId))
    .filter((file): file is { path: string; size: number; etag: string } => typeof file.etag === 'string')
    .map(({ path, etag }) => ({ path, etag }));
  const id = nextStamp();
  const changed = (input.changed ?? []).slice(0, MAX_CHANGED_LISTED);
  const name = input.name?.trim().slice(0, MAX_NAME) || undefined;
  const manifest: Manifest = { files };
  await bucket.put(`${prefix(projectId)}${id}.json`, JSON.stringify(manifest), {
    customMetadata: {
      kind: input.kind,
      ...(name ? { name } : {}),
      changed: JSON.stringify(changed),
      fileCount: String(files.length),
    },
  });
  await pruneCheckpoints(bucket, projectId);
  return { id, kind: input.kind, ...(name ? { name } : {}), changed, fileCount: files.length };
}

/**
 * R2's `include` list option: without it the runtime omits `customMetadata` from
 * listed objects. The installed `@cloudflare/workers-types` predates the option,
 * so the type is widened here rather than the option dropped.
 */
type ListWithMetadata = R2ListOptions & { include: Array<'httpMetadata' | 'customMetadata'> };

/** Versions, newest first. */
export async function listCheckpoints(bucket: R2Bucket, projectId: number): Promise<CheckpointSummary[]> {
  const options: ListWithMetadata = { prefix: prefix(projectId), include: ['customMetadata'] };
  const listed = await bucket.list(options);
  return (listed.objects ?? [])
    .flatMap((object): CheckpointSummary[] => {
      const id = Number(object.key.slice(prefix(projectId).length).replace(/\.json$/, ''));
      if (!Number.isFinite(id)) return [];
      const meta = object.customMetadata ?? {};
      const kind = KINDS.includes(meta.kind as CheckpointKind) ? (meta.kind as CheckpointKind) : 'auto';
      return [{
        id,
        kind,
        ...(meta.name ? { name: meta.name } : {}),
        changed: parseChanged(meta.changed),
        fileCount: Number(meta.fileCount) || 0,
      }];
    })
    .sort((a, b) => b.id - a.id);
}

/**
 * Make the project match a version: files that differ are restored from history,
 * files created since are removed. The current state is saved as a version first,
 * so a restore can itself be undone.
 */
export async function restoreCheckpoint(bucket: R2Bucket, projectId: number, id: number): Promise<RestoreOutcome | null> {
  const object = await bucket.get(`${prefix(projectId)}${id}.json`);
  if (!object) return null;
  const manifest = JSON.parse(await object.text()) as Manifest;

  await createCheckpoint(bucket, projectId, { kind: 'beforeRestore' });

  const current = new Map((await listWorkspaceFiles(bucket, projectId)).map((file) => [file.path, file.etag]));
  const history = await listWorkspaceHistory(bucket, projectId);
  const outcome: RestoreOutcome = { restored: [], removed: [], missing: [] };
  const wanted = new Set(manifest.files.map((file) => file.path));

  for (const file of manifest.files) {
    if (current.get(file.path) === file.etag) continue;
    // Newest archive with these exact bytes (history is newest first).
    const version = history.find((entry) => entry.path === file.path && entry.etag === file.etag);
    if (!version) { outcome.missing.push(file.path); continue; }
    const written = await restoreWorkspaceVersion(bucket, projectId, file.path, version.at);
    (written.ok ? outcome.restored : outcome.missing).push(file.path);
  }
  for (const path of current.keys()) {
    if (wanted.has(path)) continue;
    await deleteWorkspaceFile(bucket, projectId, path);
    outcome.removed.push(path);
  }
  return outcome;
}

function parseChanged(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function pruneCheckpoints(bucket: R2Bucket, projectId: number): Promise<void> {
  const listed = await bucket.list({ prefix: prefix(projectId) });
  const keys = (listed.objects ?? []).map((object) => object.key).sort((a, b) => keyStamp(a) - keyStamp(b));
  const stale = keys.slice(0, Math.max(0, keys.length - MAX_CHECKPOINTS));
  if (stale.length) await bucket.delete(stale);
}

function keyStamp(key: string): number {
  return Number(key.slice(key.lastIndexOf('/') + 1).replace(/\.json$/, '')) || 0;
}
