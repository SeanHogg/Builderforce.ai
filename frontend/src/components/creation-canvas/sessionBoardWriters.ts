/**
 * The board's writes, routed to the board that is ON SCREEN.
 *
 * A canvas turn runs in the shared run store (`startEngineRun` under `canvasRunKey`), so
 * it outlives the component that started it — closing and reopening the board, or a
 * route change, does not end it. But the turn's body was built by that component: every
 * object it stages, every transcript row, every proposal is written through the
 * starting instance's setters. Once that instance has unmounted, its setters write into
 * nothing, and on a device-only board the reply and the staged objects were lost.
 *
 * `useSessionBoardWriter` wraps one board setter (`setNodes`, `setTimeline`, …). While
 * its own instance is mounted it IS that setter — a live board behaves exactly as it
 * always has. After the instance unmounts, a write is forwarded to the newest mounted,
 * LOADED instance of the same session; with none, it is held and replayed onto the next
 * one the moment its board has loaded ({@link drainSessionBoardWrites}), after the load
 * wrote the saved board, so the turn's changes land on top of it and the next autosave
 * keeps them. If the turn ends with no board to receive them, a device-only board's
 * held writes are applied to its stored snapshot, so the work is on the device the next
 * time it is opened. (A server board saved each transcript row as it was written; its
 * held object writes replay when it is next opened in this page.)
 */
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { getRunSnapshot, subscribeRun } from '@seanhogg/builderforce-brain-embedded';
import { readLocalCreationSession, writeLocalCreationSession } from '@/domains/canvas/infrastructure/localCanvasStore';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge } from '@xyflow/react';
import { canvasRunKey } from './brainTurn/canvasRunKey';
import type { CanvasTimelineMessage } from './canvasBoardTypes';
import { timelineFromLocal, timelineToLocal } from './localTimeline';

/** The board state a turn writes and a reopened board must not lose. */
export type BoardWriteKey = 'nodes' | 'edges' | 'timeline' | 'proposedChanges' | 'acceptedProposalIds' | 'autoApplyPending';

type AnySetter = Dispatch<SetStateAction<unknown>>;

interface BoardWriter {
  key: BoardWriteKey;
  set: AnySetter;
  /** Its instance is mounted. */
  alive: boolean;
  /** Its instance's board has loaded — only then may it receive forwarded writes. */
  loaded: boolean;
}

interface HeldWrite { key: BoardWriteKey; action: SetStateAction<unknown> }

const writersBySession = new Map<string, BoardWriter[]>();
const heldBySession = new Map<string, { persistence: 'local' | 'server'; writes: HeldWrite[] }>();
const settleWatchers = new Map<string, () => void>();

function receiverFor(sessionId: string, key: BoardWriteKey): BoardWriter | undefined {
  const writers = writersBySession.get(sessionId) ?? [];
  for (let i = writers.length - 1; i >= 0; i -= 1) {
    const writer = writers[i]!;
    if (writer.key === key && writer.alive && writer.loaded) return writer;
  }
  return undefined;
}

function applyAction<T>(current: T, action: SetStateAction<unknown>): T {
  return typeof action === 'function' ? (action as (prev: T) => T)(current) : (action as T);
}

/** Apply a device-only board's held writes to its stored snapshot. */
function persistHeldLocally(sessionId: string, writes: readonly HeldWrite[]): void {
  const stored = readLocalCreationSession(sessionId);
  if (!stored) return;
  let nodes: CanvasObject[] = stored.nodes;
  let edges: Edge[] = stored.edges;
  let timeline: CanvasTimelineMessage[] = timelineFromLocal(stored.timeline);
  for (const { key, action } of writes) {
    if (key === 'nodes') nodes = applyAction(nodes, action);
    else if (key === 'edges') edges = applyAction(edges, action);
    else if (key === 'timeline') timeline = applyAction(timeline, action);
    // Proposals and the auto-apply flag are view state of a board on screen.
  }
  writeLocalCreationSession(sessionId, { ...stored, nodes, edges, timeline: timelineToLocal(timeline), updatedAt: new Date().toISOString() });
}

/** Once the session's turn has settled, keep what no board was there to receive. */
function watchForSettle(sessionId: string): void {
  if (settleWatchers.has(sessionId)) return;
  const key = canvasRunKey(sessionId);
  const check = () => {
    if (getRunSnapshot(key).running) return;
    settleWatchers.get(sessionId)?.();
    settleWatchers.delete(sessionId);
    const held = heldBySession.get(sessionId);
    if (!held || held.persistence !== 'local' || receiverFor(sessionId, 'nodes')) return;
    heldBySession.delete(sessionId);
    persistHeldLocally(sessionId, held.writes);
  };
  settleWatchers.set(sessionId, subscribeRun(key, check));
  check();
}

function forward(sessionId: string, persistence: 'local' | 'server', key: BoardWriteKey, action: SetStateAction<unknown>): void {
  const receiver = receiverFor(sessionId, key);
  if (receiver) return receiver.set(action);
  const held = heldBySession.get(sessionId) ?? { persistence, writes: [] };
  held.writes.push({ key, action });
  heldBySession.set(sessionId, held);
  watchForSettle(sessionId);
}

/**
 * The session's board has loaded on screen: it may now receive forwarded writes, and
 * the writes held while no board was mounted are replayed onto it, in order. Called
 * after the commit that wrote the loaded board, so the replay lands on top of it.
 */
export function drainSessionBoardWrites(sessionId: string): void {
  for (const writer of writersBySession.get(sessionId) ?? []) if (writer.alive) writer.loaded = true;
  const held = heldBySession.get(sessionId);
  if (!held) return;
  heldBySession.delete(sessionId);
  for (const { key, action } of held.writes) receiverFor(sessionId, key)?.set(action);
}

/** One board setter, routed to the board on screen once its own instance is gone. */
export function useSessionBoardWriter<T>(
  sessionId: string,
  persistence: 'local' | 'server',
  key: BoardWriteKey,
  set: Dispatch<SetStateAction<T>>,
): Dispatch<SetStateAction<T>> {
  // The registration this instance holds; created by the effect, so a StrictMode re-run
  // or an unmount leaves the callback pointing at a record that knows it is gone.
  const writerRef = useRef<BoardWriter | null>(null);
  useEffect(() => {
    const writer: BoardWriter = { key, set: set as AnySetter, alive: true, loaded: false };
    writerRef.current = writer;
    writersBySession.set(sessionId, [...(writersBySession.get(sessionId) ?? []), writer]);
    return () => {
      writer.alive = false;
      writer.loaded = false;
      const rest = (writersBySession.get(sessionId) ?? []).filter((candidate) => candidate !== writer);
      if (rest.length) writersBySession.set(sessionId, rest);
      else writersBySession.delete(sessionId);
    };
  }, [key, sessionId, set]);
  return useCallback((action: SetStateAction<T>) => {
    const writer = writerRef.current;
    if (!writer || writer.alive) set(action);
    else forward(sessionId, persistence, key, action as SetStateAction<unknown>);
  }, [key, persistence, sessionId, set]);
}

/**
 * `useState` for one piece of board state, with its setter routed as above. Returns the
 * routed setter AND the on-screen one — the board's loaders write only the latter, so a
 * load that resolves after its instance unmounted cannot overwrite the board now shown.
 */
export function useSessionBoardState<T>(
  sessionId: string,
  persistence: 'local' | 'server',
  key: BoardWriteKey,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>, Dispatch<SetStateAction<T>>] {
  const [value, setOnScreen] = useState<T>(initial);
  return [value, useSessionBoardWriter(sessionId, persistence, key, setOnScreen), setOnScreen];
}

/** Test seam: forget every registration and held write. */
export function resetSessionBoardWriters(): void {
  for (const unsubscribe of settleWatchers.values()) unsubscribe();
  settleWatchers.clear();
  writersBySession.clear();
  heldBySession.clear();
}
