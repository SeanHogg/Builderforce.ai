/**
 * useVideoVersions — host-side persistence layer for the studio's version
 * history. The studio-embedded package only declares the *contract*
 * (`onSaveVersion`, `versions`, `onLoadVersion`); this hook is the IDE's
 * implementation of that contract.
 *
 * Persistence triad:
 *   • Metadata sidecar (`videos/v<n>.json`) → project file API (saveFile).
 *     Lives in the project's file tree, syncs cross-device via the worker.
 *   • MP4 blob (key `${projectId}:videos/v<n>.mp4`) → IndexedDB.
 *     Binary-safe, browser-local. Cross-device sync needs R2 (logged as a
 *     gap — see the "studio video binaries are IndexedDB-only" entry).
 *
 * Single source of truth for "which versions exist": the `files` list the
 * IDE already maintains. We filter for `videos/*.json` and parse each one.
 * That way, deleting a sidecar in the file tree automatically removes the
 * entry from the version list (no separate "version registry" to drift).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VideoVersionEntry, VideoVersionParams } from '@seanhogg/builderforce-studio-embedded';
import type { FileEntry } from '@/lib/types';
import { fetchFileContent, saveFile } from '@/lib/api';

const IDB_NAME = 'builderforce-studio-videos';
const IDB_STORE = 'videos';
const IDB_VERSION = 1;
const VIDEO_DIR = 'videos';

interface SidecarFile {
  /** Saved version params (must match VideoVersionParams). */
  params: VideoVersionParams;
  /** When the version was generated (ISO). */
  createdAt: string;
}

export interface UseVideoVersionsResult {
  versions: VideoVersionEntry[];
  onSaveVersion: (blob: Blob, params: VideoVersionParams) => Promise<string>;
  onLoadVersion: (id: string) => Promise<Blob>;
}

export function useVideoVersions(
  projectId: number | string,
  files: FileEntry[],
): UseVideoVersionsResult {
  const [versions, setVersions] = useState<VideoVersionEntry[]>([]);

  // Recompute the list when project files change. Sidecar parse failures
  // skip that entry — a corrupt JSON shouldn't break the panel.
  const sidecarPaths = useMemo(
    () =>
      files
        .filter((f) => f.path.startsWith(`${VIDEO_DIR}/`) && f.path.endsWith('.json'))
        .map((f) => f.path)
        .sort(), // v1, v2, v3... lex order is the same as numeric for our naming.
    [files],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded: VideoVersionEntry[] = [];
      for (const path of sidecarPaths) {
        try {
          const text = await fetchFileContent(projectId, path);
          const sidecar = JSON.parse(text) as SidecarFile;
          loaded.push({
            id: pathToId(path),
            label: pathToLabel(path),
            params: sidecar.params,
          });
        } catch {
          // Skip unreadable sidecars (corrupt JSON, network blip).
        }
      }
      if (!cancelled) setVersions(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, sidecarPaths]);

  const onSaveVersion = useCallback(
    async (blob: Blob, params: VideoVersionParams): Promise<string> => {
      const nextN = nextVersionNumber(sidecarPaths);
      const sidecarPath = `${VIDEO_DIR}/v${nextN}.json`;
      const id = pathToId(sidecarPath);
      const idbKey = idbKeyFor(projectId, sidecarPath);

      // Order matters: write the binary blob first; if the JSON save then
      // fails, the blob is orphaned (cheap, IDB-local) but the file tree
      // doesn't surface a half-saved version. The reverse order would let
      // the user click a sidecar pointing at a blob that doesn't exist.
      await putBlob(idbKey, blob);
      const sidecar: SidecarFile = { params, createdAt: new Date().toISOString() };
      await saveFile(projectId, sidecarPath, JSON.stringify(sidecar, null, 2));

      // Optimistic local update so the version appears before the next
      // `files` refresh round-trip lands.
      setVersions((prev) => [
        ...prev,
        { id, label: `v${nextN}`, params },
      ]);
      return id;
    },
    [projectId, sidecarPaths],
  );

  const onLoadVersion = useCallback(
    async (id: string): Promise<Blob> => {
      const sidecarPath = idToPath(id);
      const idbKey = idbKeyFor(projectId, sidecarPath);
      const blob = await getBlob(idbKey);
      if (!blob) {
        throw new Error(
          `Version ${pathToLabel(sidecarPath)}: MP4 blob not in IndexedDB on this device. ` +
            `Cross-device video sync is not yet wired (see Consolidated Gap Register).`,
        );
      }
      return blob;
    },
    [projectId],
  );

  return { versions, onSaveVersion, onLoadVersion };
}

// ---------------------------------------------------------------------------
// IndexedDB helpers — small wrapper so the hook above stays readable.
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
  });
}

async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'));
  });
}

async function getBlob(key: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('IDB get failed'));
  });
}

// ---------------------------------------------------------------------------
// id ⇄ path translation. The version "id" the panel passes back to us is
// just the sidecar path — keeping the mapping trivial means there's no
// separate registry to drift out of sync with the file tree.
// ---------------------------------------------------------------------------

function pathToId(path: string): string {
  return path;
}
function idToPath(id: string): string {
  return id;
}
function pathToLabel(path: string): string {
  // `videos/v3.json` → `v3`
  const file = path.slice(VIDEO_DIR.length + 1);
  return file.replace(/\.json$/, '');
}
function nextVersionNumber(existingPaths: readonly string[]): number {
  let max = 0;
  for (const p of existingPaths) {
    const m = /\/v(\d+)\.json$/.exec(p);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return max + 1;
}
function idbKeyFor(projectId: number | string, sidecarPath: string): string {
  return `${projectId}:${sidecarPath.replace(/\.json$/, '.mp4')}`;
}
