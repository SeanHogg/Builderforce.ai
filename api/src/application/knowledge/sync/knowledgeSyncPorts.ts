/**
 * The ports of pack sync (PRD 41 A11): what the sync use cases need beyond the knowledge store and the
 * extracted cache. Bound to one (tenant, project) by the composition, like every knowledge port.
 */
import type { Bundle } from '../knowledgeBundles';
import type { KnowledgeLedgerPort } from '../knowledgeLedger';

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
  /**
   * The root's current sources (path and the hash their extracted output is keyed under): the ledger rows over
   * the legacy objects. Pass `ledger` to read inside a transaction.
   */
  sources(rootId: string, ledger?: KnowledgeLedgerPort): Promise<Array<{ path: string; hash: string }>>;
  /**
   * The extracted bodies the project already holds among `hashes` (under ANY root), each with the `sourceRef`s its
   * entries name. ONE index query for any number of hashes, never an object read per hash.
   */
  heldBodies(hashes: readonly string[], ledger?: KnowledgeLedgerPort): Promise<Map<string, string[]>>;
  /** Writes a pack's bodies as ONE content-addressed bundle object (the pack's only body write). */
  putBundle(bundle: Bundle): Promise<void>;
  /** Records a review's source list as the immutable snapshot of `digest` (written once per digest). */
  snapshotReview(rootId: string, digest: string, sources: ReadonlyArray<{ path: string; hash: string }>): Promise<void>;
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
/** Hashes one `have` request may ask about: it is ONE index query, so the bound is the request body, not the database. */
export const MAX_HAVE_HASHES = 50_000;
/** Parts and `syncId`s expire after this. */
export const STAGE_TTL_MS = 60 * 60 * 1000;
export const SYNC_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
