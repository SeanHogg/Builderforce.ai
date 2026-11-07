/**
 * The ports of pack sync (PRD 41 A11): what the sync use cases need beyond the knowledge store and the
 * extracted cache. Bound to one (tenant, project) by the composition, like every knowledge port.
 */

export interface SyncState {
  /** Bumped by every applied pack; 0 = the server holds nothing synced for the root. */
  generation: number;
  /** The root digest (`manifestTree(...).root`) the server reached with that generation. */
  digest: string;
}

export interface KnowledgeSyncPort {
  /** The root's acknowledged state; `{ generation: 0, digest: '' }` when never synced. */
  state(rootId: string): Promise<SyncState>;
  saveState(rootId: string, state: SyncState): Promise<void>;
  /** The root's current sources (path and the hash their extracted output is keyed under). */
  sources(rootId: string): Promise<Array<{ path: string; hash: string }>>;
  /** Which extracted outputs the project already holds, in the order asked (under ANY root). */
  hasExtracted(hashes: readonly string[]): Promise<boolean[]>;
  /** Parks one part of a multi-part pack until the last arrives. */
  stagePart(syncId: string, part: number, bytes: Uint8Array): Promise<void>;
  /** The parts staged under `syncId`, in order, when exactly `0..parts-1` are present and none expired; else null. */
  stagedParts(syncId: string, parts: number): Promise<Uint8Array[] | null>;
  dropStaged(syncId: string): Promise<void>;
  /** Deletes staged parts older than the expiry (one hour). Best effort. */
  sweepStaged(): Promise<void>;
  /** Forgets the root's sync state (the root was deleted). */
  clearRoot(rootId: string): Promise<void>;
}

/** A pack the caller got wrong or cannot be applied: the route answers `status` with `{ error, code }`. */
export class KnowledgeSyncError extends Error {
  constructor(readonly status: 400 | 409 | 413 | 422, readonly code: string, message: string, readonly detail?: Record<string, unknown>) {
    super(message);
    this.name = 'KnowledgeSyncError';
  }
}

/** Largest compressed request body (one part). */
export const MAX_SYNC_BODY_BYTES = 8 * 1024 * 1024;
/** Most parts a pack may be split into (64 MB decoded / compressed worst case stays well inside). */
export const MAX_SYNC_PARTS = 64;
/** Hashes one `have` request may ask about (each is a bucket lookup). */
export const MAX_HAVE_HASHES = 2000;
/** Parts and `syncId`s expire after this. */
export const STAGE_TTL_MS = 60 * 60 * 1000;
export const SYNC_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
