/**
 * THE ONE-TIME IMPORT of `builderforce:create:local-*` boards into the local-first store.
 *
 * Before this program a guest's board was one JSON blob in `localStorage` (about 5 MB for the whole
 * origin, with images inlined as data URLs). Run at store boot, before the first board open, this
 * moves every such board into records — idempotently, and without ever losing one:
 *
 *   - Each board is ONE transaction: header, objects, connections, transcript, media manifests and a
 *     marker (`canvas-legacy-import:<localId>`, the store's read mark) — all or nothing. A re-run finds
 *     the marker and skips the board, so N boards stay N boards.
 *   - The legacy key is removed only AFTER the transaction committed — never before. A failure (a
 *     quota refusal, a store that throws) is REPORTED and leaves the key where it was, to be tried on
 *     the next boot.
 *   - Data-URL media is converted to `BlobStore` blobs + manifests (which also frees localStorage).
 *     The blob is written before the transaction (they are two databases), under an id derived from
 *     the node, so a re-run overwrites the same blob rather than leaking a second one.
 *   - Ids the sync envelope would refuse (a board or node id that is not a UUID) are made
 *     deterministic with `stableEntityId('canvas-legacy:<localId>:<id>')`, so a second device that
 *     imports the same board names the same records.
 *   - A board whose id already has a server mapping (the legacy claim replay already took it) is
 *     skipped and its key removed.
 *   - The reader is kept ONLY here, and is deleted after one release train.
 */

import { isLocalId, stableEntityId, type EntityDestination, type LocalFirstStore } from '@builderforce/local-first';
import { localStore, removeLocal } from '@/lib/storage';
import { reportLocalFirstFailure, type LocalFirstFailureSink } from '@/lib/localFirst/reportLocalFirstFailure';
import { parseLocalCreationSnapshot, LOCAL_CREATION_PREFIX, type LocalCreationSnapshot } from '../../domain/boardSnapshot';
import type { CanvasBoard } from '../../domain/canvasBoard';
import type { BlobStore, StoredBlob } from './blobStore';
import { writeNewBoard } from './boardCommit';
import { writeRecord, type JournalContext } from './boardJournal';
import { CANVAS_BOARD, CANVAS_MEDIA, legacyImportMark, mediaUrl, syncableId, type MediaPayload, type TimelinePayload } from './boardRecords';

const STORAGE_PREFIX = 'builderforce:create:';
const DATA_URL = /^data:([^;,]+)(;base64)?,([\s\S]*)$/;

export interface LegacyImportOptions extends Partial<JournalContext> {
  store: LocalFirstStore;
  blobs: BlobStore;
  deviceId: string;
  /** Unbound for a guest; the account's when already signed in (the board is then journaled at once). */
  destination: EntityDestination;
  /** `localStorage` by default. */
  storage?: Pick<Storage, 'length' | 'key' | 'getItem'> | null;
  /** Removes a legacy key; `removeLocal` by default (a failed remove leaves nothing worse than what was there). */
  removeKey?: (key: string) => void;
  report?: LocalFirstFailureSink;
}

export interface LegacyImportResult {
  imported: string[];
  /** Already imported (or already claimed): nothing written, a leftover key removed. */
  skipped: string[];
  failed: Array<{ localId: string; reason: string }>;
}

interface Extracted {
  nodes: CanvasBoard['nodes'];
  media: Array<{ id: string; objectId: string; blob: Blob; name: string }>;
}

/** The board ids, newest first or not — a stable order: by key. */
function legacyKeys(storage: NonNullable<LegacyImportOptions['storage']>): string[] {
  const keys: string[] = [];
  for (let position = 0; position < storage.length; position += 1) {
    const key = storage.key(position);
    if (!key?.startsWith(`${STORAGE_PREFIX}${LOCAL_CREATION_PREFIX}`)) continue;
    const localId = key.slice(STORAGE_PREFIX.length);
    // A sidecar (`…:checkpoints`) and the old tool boards are not boards to import.
    if (localId.includes(':') || localId.startsWith(`${LOCAL_CREATION_PREFIX}tool-`)) continue;
    keys.push(key);
  }
  return keys.sort();
}

function decodeDataUrl(value: string): Blob | undefined {
  const match = DATA_URL.exec(value);
  if (!match) return undefined;
  const [, mimeType, base64, body] = match;
  if (base64) {
    const binary = atob(body!);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
  }
  return new Blob([decodeURIComponent(body!)], { type: mimeType });
}

/** Every data URL in a node's data, replaced by `media:<id>` and returned as a blob. */
function extractMedia(localId: string, nodes: CanvasBoard['nodes'], idOf: (nodeId: string) => string): Extracted {
  const media: Extracted['media'] = [];
  const out = nodes.map((node) => {
    const objectId = idOf(node.id);
    let seen = 0;
    const walk = (value: unknown): unknown => {
      if (typeof value === 'string' && value.startsWith('data:')) {
        const blob = decodeDataUrl(value);
        if (!blob) return value;
        const id = stableEntityId(`canvas-legacy-media:${localId}:${node.id}:${seen}`);
        seen += 1;
        media.push({ id, objectId, blob, name: `${node.data.kind}-${seen}` });
        return mediaUrl(id);
      }
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]));
      return value;
    };
    return { ...node, id: objectId, data: walk(node.data) as typeof node.data };
  });
  return { nodes: out, media };
}

function boardOf(snapshot: LocalCreationSnapshot, localId: string, extracted: Extracted): CanvasBoard {
  return {
    nodes: extracted.nodes,
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      id: syncableId(`canvas-legacy:${localId}`, edge.id),
      source: syncableId(`canvas-legacy:${localId}`, edge.source),
      target: syncableId(`canvas-legacy:${localId}`, edge.target),
    })),
  };
}

export async function importLegacyBoards(options: LegacyImportOptions): Promise<LegacyImportResult> {
  const result: LegacyImportResult = { imported: [], skipped: [], failed: [] };
  const storage = options.storage === undefined ? localStore() : options.storage;
  if (!storage) return result;
  const report = options.report ?? reportLocalFirstFailure;
  const removeKey = options.removeKey ?? removeLocal;
  const ctx: JournalContext = { deviceId: options.deviceId, ...(options.now ? { now: options.now } : {}) };

  for (const key of legacyKeys(storage)) {
    const localId = key.slice(STORAGE_PREFIX.length);
    try {
      const snapshot = parseLocalCreationSnapshot(storage.getItem(key) ?? '');
      if (!snapshot) throw new Error('legacy_board_unparseable');
      const suffix = localId.slice(LOCAL_CREATION_PREFIX.length);
      const boardId = isLocalId(suffix) ? suffix : stableEntityId(`canvas-legacy:${localId}`);
      const idOf = (nodeId: string): string => syncableId(`canvas-legacy:${localId}`, nodeId);
      const extracted = extractMedia(localId, snapshot.nodes, idOf);
      const mark = legacyImportMark(localId);

      // Cheap check first, so a re-run does not rewrite blobs for a board that is already in.
      const already = await options.store.read(async (tx) => Boolean(await tx.readMark(mark)) || Boolean(await tx.mapping(CANVAS_BOARD, boardId, options.destination)));
      if (already) {
        removeKey(key);
        result.skipped.push(localId);
        continue;
      }

      const stored = new Map<string, StoredBlob>();
      for (const item of extracted.media) stored.set(item.id, await options.blobs.put(item.id, item.blob));
      const stamp = (options.now?.() ?? new Date()).toISOString();
      const committed = await options.store.transact(async (tx) => {
        // Re-checked inside the transaction: two tabs booting at once import a board once.
        if (await tx.readMark(mark)) return false;
        // Manifests first: an object that refers to media still `local` must not be journaled, and
        // `writeRecord` can only see that once the manifest exists.
        for (const item of extracted.media) {
          const info = stored.get(item.id)!;
          const payload: MediaPayload = {
            boardId, objectId: item.objectId, mimeType: info.mimeType, bytes: info.bytes, sha256: info.sha256, name: item.name, status: 'local', attempts: 0,
          };
          await writeRecord(tx, ctx, undefined, { entityType: CANVAS_MEDIA, id: item.id, payload, destination: options.destination, boardId, journal: false });
        }
        await writeNewBoard(tx, ctx, {
          boardId,
          destination: options.destination,
          header: {
            title: snapshot.title,
            ...(snapshot.folder ? { folder: snapshot.folder } : {}),
            ...(snapshot.mode ? { mode: snapshot.mode } : {}),
            ...(snapshot.initialPrompt ? { initialPrompt: snapshot.initialPrompt } : {}),
            ...(snapshot.viewport ? { viewport: snapshot.viewport } : {}),
          },
          board: boardOf(snapshot, localId, extracted),
          timeline: (snapshot.timeline ?? []).map((message): Omit<TimelinePayload, 'boardId'> => ({ ...message })),
        });
        await tx.setReadMark(mark, stamp);
        return true;
      });
      // Only now, with the records committed, does the legacy copy go.
      removeKey(key);
      (committed ? result.imported : result.skipped).push(localId);
    } catch (error) {
      report(`legacyBoardImport:${localId}`, error);
      result.failed.push({ localId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
