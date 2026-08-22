/**
 * ADOPT REMOTE BOARD — taking a collaborator's board over the one on screen.
 *
 * ── THE SAME TWELVE LINES, TWICE, WITH A HOLE IN BOTH ────────────────────────
 * A server session learns that somebody else saved through two entirely separate
 * channels: the 8-second presence poll (which every client has) and the live
 * relay (which a client behind a corporate proxy does not). Both then did the
 * identical thing — re-read the session, translate the graph, replace the nodes,
 * the edges, the persisted-id set, the title and the roster, advance the
 * revision, re-sign the board twice, and say something — as two hand-written
 * copies inside two `useEffect`s in `CanvasInner`.
 *
 * They had already drifted in one place (`?? remoteRevision` on one side only),
 * and both had the SAME hole: `boardFromPersistedGraph` returns the objects it
 * REFUSED, and neither copy looked. So a collaborator on a newer deployment
 * saving a kind this build does not declare made objects quietly vanish from
 * this browser's board — while the initial load, three hundred lines away, said
 * so out loud. The rule that a rejection is always reported was true of one door
 * out of three.
 *
 * ── THE GATE, WHICH IS THE REASON THIS IS A USE CASE ─────────────────────────
 * `saveInFlight || currentGraph !== lastSavedGraph` is the one thing standing
 * between "your collaborator's edit arrives" and "your unsaved work disappears".
 * It was a bare boolean expression repeated at two call sites and named nowhere.
 * It is {@link remoteBoardBlocked} now, and it is the first thing this file's
 * tests assert.
 */

import { boardFromPersistedGraph, type CanvasBoard, type RejectedCanvasObject } from '../domain/canvasBoard';
import { boardSignature, type CanvasSessionMember, type CanvasSessionPort } from './PersistCanvas';

/**
 * What this browser is holding, and how sure it is about it.
 *
 * `signature` vs `savedSignature` is the whole question: equal means everything
 * on screen is on the server, different means there are edits only this browser
 * has. The names are deliberately not `currentGraph`/`lastSavedGraph` — those
 * were refs holding JSON, and the thing they encode is whether it is SAFE to
 * replace what somebody is looking at.
 */
export interface LocalBoardState {
  /** A save is on the wire right now. */
  saving: boolean;
  /** The board as it stands on screen. */
  signature: string;
  /** The board as last written to the server. */
  savedSignature: string;
  /** The revision this browser believes it is at. */
  revision: number;
}

/** Why a newer board must wait. `null` means it may land. */
export type RemoteBoardBlock = 'saving' | 'unsaved-edits';

export type AdoptRemoteBoardDecision =
  | { adopt: false; reason: RemoteBoardBlock | 'not-newer' }
  | {
      adopt: true;
      board: CanvasBoard;
      revision: number;
      title: string;
      members: readonly CanvasSessionMember[];
      /** Objects the collaborator's board carried that this build cannot render. */
      rejected: RejectedCanvasObject[];
      /** The signature of what was adopted — what "saved" now means. */
      signature: string;
    };

/**
 * Whether a newer server board may replace what is on screen.
 *
 * Refuses while a save is in flight (the server is about to be newer for a
 * reason this browser caused) and while the board holds edits that have not been
 * written (adopting would delete them with no undo and no message). Neither is a
 * failure: the poll comes round again in eight seconds, and the relay re-fires
 * on the next revision.
 */
export function remoteBoardBlocked(local: LocalBoardState): RemoteBoardBlock | null {
  if (local.saving) return 'saving';
  if (local.signature !== local.savedSignature) return 'unsaved-edits';
  return null;
}

/**
 * Read the session and decide whether its board should replace this one.
 *
 * The caller has already had a CHEAPER hint that something changed — a revision
 * on the presence payload, a frame off the relay — and those probes differ
 * enough that they stay at the call site. What is identical from here on is
 * everything this function does.
 */
export async function adoptRemoteBoard(
  sessionId: string,
  local: LocalBoardState,
  sessions: CanvasSessionPort,
): Promise<AdoptRemoteBoardDecision> {
  const blocked = remoteBoardBlocked(local);
  if (blocked) return { adopt: false, reason: blocked };

  const snapshot = await sessions.read(sessionId);
  // Re-checked AFTER the read, not only before it: a save can land while the
  // request is in flight, and adopting then would roll this browser backwards.
  if (snapshot.revision <= local.revision) return { adopt: false, reason: 'not-newer' };

  const { board, rejected } = boardFromPersistedGraph(snapshot.graph);
  return {
    adopt: true,
    board,
    revision: snapshot.revision,
    title: snapshot.title,
    members: snapshot.members,
    rejected,
    signature: boardSignature(board),
  };
}
