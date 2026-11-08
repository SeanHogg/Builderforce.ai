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
  /**
   * The root's acknowledged state; `{ generation: 0, digest: '' }` when it has no row. A `sync.json` object left by
   * an older version is copied into the row on first read, then deleted.
   */
  state(rootId: string, ledger?: KnowledgeLedgerPort): Promise<SyncState>;
  /**
   * The root's current sources (path and the hash their extracted output is keyed under): the ledger rows over
   * the legacy objects. Pass `ledger` to read inside a transaction.
   */
  sources(rootId: string, ledger?: KnowledgeLedgerPort): Promise<Array<{ path: string; hash: string }>>;
  /**
   * Which `(hash, sourceRef)` pairs the project already holds (by position): the stored body of `hash`, under ANY root,
   * has an entry for `sourceRef`. A hash held only under another root answers false, so just this root's entry is
   * uploaded. ONE indexed query for any number of pairs. No object is read or probed: the sweep is the only deleter of
   * bundles and it deletes only bundles no index row names, so an index row always has its object. With `opts.entryless`, a
   * source a client declared to carry no extracted output (a binary file) counts as held too (`verifyBodies`); the have-answer never does.
   */
  heldEntries(pairs: ReadonlyArray<{ hash: string; sourceRef: string }>, ledger?: KnowledgeLedgerPort, opts?: { entryless?: boolean }): Promise<Set<number>>;
  /** Writes a pack's bodies as ONE content-addressed bundle object (the pack's only body write). */
  putBundle(bundle: Bundle): Promise<void>;
  /** Records a review's source list as the immutable snapshot of `digest` (written once per digest). */
  snapshotReview(rootId: string, digest: string, sources: ReadonlyArray<{ path: string; hash: string }>): Promise<void>;
  /** Parks one earlier part of a multi-part pack until the last arrives. Keyed by the actor, so one person's `syncId` is not another's. */
  stagePart(actor: string, syncId: string, part: number, bytes: Uint8Array): Promise<void>;
  /**
   * The first `parts` parts staged under `syncId`, in order, when all are present and none expired; else null.
   * Throws {@link KnowledgeSyncError} (413) as soon as the parts add up past `maxBytes`, before they are joined.
   */
  stagedParts(actor: string, syncId: string, parts: number, maxBytes: number): Promise<Uint8Array[] | null>;
  dropStaged(actor: string, syncId: string): Promise<void>;
  /** Deletes staged parts older than the expiry (one hour). Best effort. */
  sweepStaged(): Promise<void>;
  /** Deletes the legacy per-source objects of removed sources (at most 1,000 keys per call). */
  deleteLegacySources(rootId: string, sourceIds: readonly string[]): Promise<void>;
  /** Forgets the root's sync state, leaves and `sync.json` (the root was deleted). */
  clearRoot(rootId: string): Promise<void>;
}

/** A pack the caller got wrong or cannot be applied: the route answers `status` with `{ error, code }`. */
export class KnowledgeSyncError extends Error {
  constructor(readonly status: 400 | 403 | 409 | 413 | 422 | 503, readonly code: string, message: string, readonly detail?: Record<string, unknown>) {
    super(message);
    this.name = 'KnowledgeSyncError';
  }

  /** Seconds a client should wait before retrying (a 503), as the route's `Retry-After`. */
  get retryAfterSeconds(): number | undefined {
    const s = this.detail?.['retryAfterSeconds'];
    return typeof s === 'number' ? s : undefined;
  }
}

/** How long a request waits for the project's sync lock before it answers a retryable 503. */
export const SYNC_LOCK_TIMEOUT = '10s';
/** The `Retry-After` of that 503. */
export const SYNC_LOCK_RETRY_SECONDS = 5;

/** Largest compressed request body (one part). */
export const MAX_SYNC_BODY_BYTES = 8 * 1024 * 1024;
/** Most parts a pack may be split into. */
export const MAX_SYNC_PARTS = 8;
/**
 * The parts of one pack may add up to at most this (checked while they load, before they are decoded). It matches the
 * codec's decoded cap (24 MB): a compressed pack larger than what it may inflate to is never legitimate.
 */
export const MAX_PACK_BYTES = 24 * 1024 * 1024;
/** Pairs one `have` request may ask about: it is ONE index query, so the bound is the request body, not the database. */
export const MAX_HAVE_HASHES = 50_000;
/** Parts and `syncId`s expire after this. */
export const STAGE_TTL_MS = 60 * 60 * 1000;
export const SYNC_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
