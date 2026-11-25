/**
 * OPEN A BOARD, LOCAL FIRST — render what this device holds, then reconcile with the server behind it.
 *
 * Open order (design §2): (1) read the board from the store and hand it over at once; (2) when the
 * board has a server and the network is up, reconcile in the BACKGROUND; (3) never block the render
 * on the network, and never report "load failed" while a replica exists — a failed read is the
 * outcome `offline`, with the replica still the thing on screen.
 *
 * The server is reached through ONE port, `BoardReconcileSource` (REST `creationSessionsApi.get` +
 * `timeline.list` today). Serving boards from `/api/sync/v1/pull` later swaps that port and nothing
 * else here.
 *
 * Which board wins reuses what the canvas already has rather than a second rule: `adoptRemoteBoard`
 * decides whether the server's board is newer and translates its graph (and says what it could not
 * render), and `mergeCollaboratorBoards` — local last — is the rebase when this device still has
 * unsent edits. The store ends up holding the same union: records with a pending local edit are
 * never overwritten (`ingestFromServer`).
 */

import type { EntityDestination, LocalFirstStore } from '@builderforce/local-first';
import { adoptRemoteBoard } from '../../application/AdoptRemoteBoard';
import { boardSignature, type CanvasSessionPort } from '../../application/PersistCanvas';
import { mergeCollaboratorBoards, type CanvasBoard, type RejectedCanvasObject } from '../../domain/canvasBoard';
import { reportLocalFirstFailure, type LocalFirstFailureSink } from '@/lib/localFirst/reportLocalFirstFailure';
import { hasPendingFor, ingestFromServer, readBoard, seedFromServer, type BoardReplica } from './boardReplica';
import type { ServerBoardSnapshot } from './boardRecords';

/** How a board's server copy is read. The one thing that changes when pull replaces REST. */
export interface BoardReconcileSource {
  read(boardId: string): Promise<ServerBoardSnapshot>;
}

export interface BoardOpenOptions {
  store: LocalFirstStore;
  /** The destination a server board's records are snapshotted under: the signed-in account's. */
  destination: EntityDestination;
  /** Absent for a board that only exists here (a guest's). */
  source?: BoardReconcileSource;
  isOnline?: () => boolean;
  report?: LocalFirstFailureSink;
  now?: () => Date;
}

export type ReconcileOutcome =
  /** No source, no network, or the read failed: the replica (if any) stays on screen. */
  | { kind: 'offline'; error?: string }
  /** The replica is as new as the server's board. */
  | { kind: 'current' }
  | {
    kind: 'seeded' | 'replaced' | 'rebased';
    replica: BoardReplica;
    /** The board `mergeCollaboratorBoards` produced for a rebase (local last); the store holds the same objects. */
    rebased?: CanvasBoard;
    /** Objects the server's board carried that this build cannot render. */
    rejected: RejectedCanvasObject[];
  };

export interface OpenedBoard {
  /** What the device holds right now; undefined when the board was never here. */
  replica?: BoardReplica;
  /** Settles when the background reconcile has finished (and never rejects). */
  reconciled: Promise<ReconcileOutcome>;
}

/** The canvas's read port, over the reconcile source; it remembers the snapshot it read so the store can take it too. */
function sessionPortOver(source: BoardReconcileSource, captured: { snapshot?: ServerBoardSnapshot }): CanvasSessionPort {
  return {
    async read(boardId) {
      const snapshot = await source.read(boardId);
      captured.snapshot = snapshot;
      return { graph: snapshot.graph, revision: snapshot.revision, title: snapshot.title, members: [] };
    },
    // Studio writes through the journal; a graph replace is not a thing this port does.
    replaceGraph: () => Promise.reject(new Error('studio_writes_through_the_journal')),
  };
}

export async function reconcileBoard(options: BoardOpenOptions, boardId: string, replica?: BoardReplica): Promise<ReconcileOutcome> {
  const { source } = options;
  if (!source || options.isOnline?.() === false) return { kind: 'offline' };
  const report = options.report ?? reportLocalFirstFailure;
  const captured: { snapshot?: ServerBoardSnapshot } = {};
  const port = sessionPortOver(source, captured);
  try {
    if (!replica) {
      const snapshot = await source.read(boardId);
      await seedFromServer(options.store, snapshot, options.destination, { now: options.now });
      const seeded = await readBoard(options.store, boardId);
      return seeded ? { kind: 'seeded', replica: seeded, rejected: seeded.rejected } : { kind: 'offline', error: 'seed_not_readable' };
    }
    // Unsent edits are not "unsaved": the journal holds them, so they never block adoption — they rebase.
    const signature = boardSignature(replica.board);
    const decision = await adoptRemoteBoard(boardId, { saving: false, signature, savedSignature: signature, revision: replica.serverRevision ?? -1 }, port);
    if (!decision.adopt || !captured.snapshot) return { kind: 'current' };
    const pending = await hasPendingFor(options.store, boardId);
    await ingestFromServer(options.store, captured.snapshot, options.destination, { replaceMissing: true, now: options.now });
    const fresh = await readBoard(options.store, boardId);
    if (!fresh) return { kind: 'offline', error: 'replica_lost' };
    return pending
      ? { kind: 'rebased', replica: fresh, rebased: mergeCollaboratorBoards(replica.board, decision.board), rejected: decision.rejected }
      : { kind: 'replaced', replica: fresh, rejected: decision.rejected };
  } catch (error) {
    // The expected failure is the network being down; it is still REPORTED, never swallowed, and the
    // replica stays the board on screen.
    report('boardOpen.reconcile', error);
    return { kind: 'offline', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function openBoard(options: BoardOpenOptions, boardId: string): Promise<OpenedBoard> {
  const replica = await readBoard(options.store, boardId);
  return { ...(replica ? { replica } : {}), reconciled: reconcileBoard(options, boardId, replica) };
}
