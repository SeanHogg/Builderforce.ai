/**
 * Studio local-first, slice 1 — `handleSyncPush` carries canvas entities end to end.
 *
 * The REAL push (envelope, replay, dependency holds, chunk transaction, receipts) and the
 * REAL canvas importers run against the in-memory sync stores; only the canvas context's
 * database seams (board access, the per-edit writer, the transcript writer, the graph reads)
 * are replaced by a small in-memory board model, so what is proved is the protocol
 * behaviour: every new type is accepted, a viewer cannot write, a replay is a no-op,
 * children wait for their board, and a throw rolls the whole chunk back.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_PROTOCOL_VERSION, hashSyncPayload, type EntityDestination } from '../../../domain/sync/syncProtocol';
import { createMemorySyncStores } from '../../sync/__fixtures__/memorySyncStores';
import { handleSyncPush } from '../../sync/handleSyncPush';
import { dbOf } from '../../sync/importers/__fixtures__/importerHarness';
import type { SyncNamedImporters } from '../../sync/syncPorts';
import type { CanvasSyncPorts } from './canvasSyncPorts';
import { importSyncedCanvasBoard } from './importSyncedCanvasBoard';
import { importSyncedCanvasEdge } from './importSyncedCanvasEdge';
import { importSyncedCanvasMedia } from './importSyncedCanvasMedia';
import { importSyncedCanvasObject } from './importSyncedCanvasObject';
import { importSyncedCanvasTimeline } from './importSyncedCanvasTimeline';

interface BoardModel {
  tenantId: number;
  status: string;
  roles: Record<string, string>;
  objects: Set<string>;
}

const world = vi.hoisted(() => ({
  boards: new Map<string, BoardModel>(),
  edits: [] as string[],
  keys: new Set<string>(),
  timeline: new Set<string>(),
  snapshots: [] as string[],
  explodeOn: new Set<string>(),
}));

vi.mock('../sessionAccess', async (original) => ({
  ...(await original<typeof import('../sessionAccess')>()),
  resolveSessionAccess: async (_db: unknown, id: string, tenantId: number, userId: string) => {
    if (world.explodeOn.has(id)) throw new Error('db down');
    const board = world.boards.get(id);
    const role = board?.roles[userId];
    return board && board.tenantId === tenantId && role
      ? { role, session: { id, tenantId, status: board.status, segmentId: 'seg-1', title: 'Board', mode: 'chat' } }
      : null;
  },
}));

vi.mock('../creationGraphWriter', async (original) => ({
  ...(await original<typeof import('../creationGraphWriter')>()),
  newCreationSessionStatements: (_db: unknown, input: { sessionId: string; tenantId: number; authorUserId: string }) => {
    world.boards.set(input.sessionId, {
      tenantId: input.tenantId, status: 'active', roles: { [input.authorUserId]: 'owner' }, objects: new Set(),
    });
    return [];
  },
}));

vi.mock('../boardEditWriter', () => ({
  applyBoardEdit: async (_tx: unknown, edit: { sessionId: string; eventType: string; eventObjectId?: string; idempotencyKey: string | null }) => {
    if (edit.idempotencyKey && world.keys.has(edit.idempotencyKey)) return { status: 'replayed', revision: 2 };
    if (edit.idempotencyKey) world.keys.add(edit.idempotencyKey);
    world.edits.push(edit.eventType);
    if (edit.eventType === 'object.created' && edit.eventObjectId) world.boards.get(edit.sessionId)?.objects.add(edit.eventObjectId);
    return { status: 'applied', revision: world.edits.length + 1 };
  },
}));

vi.mock('../resourceAccess', () => ({ validateResourceAccess: async () => null }));

vi.mock('../timelineWriter', () => ({
  appendTimelineMessage: async (_db: unknown, input: { sessionId: string; clientMessageId: string }) => {
    const key = `${input.sessionId}:${input.clientMessageId}`;
    const inserted = !world.timeline.has(key);
    world.timeline.add(key);
    return { message: { id: 31 }, inserted };
  },
}));

vi.mock('./canvasGraphReads', () => ({
  boardOfObject: async () => null,
  boardOfConnection: async () => null,
  objectsOnBoard: async (_db: unknown, boardId: string, ids: string[]) =>
    new Set(ids.filter((id) => world.boards.get(boardId)?.objects.has(id))),
  countBoardObjects: async () => 0,
  countBoardConnections: async () => 0,
  displayNameOf: async () => 'Ann',
}));

const NOW = new Date('2026-02-01T10:00:00.000Z');
const DESTINATION: EntityDestination = { kind: 'bound', tenantId: '7', accountId: 'user-7' };
const AUTH = { tenantId: 7, userId: 'user-7', role: 'developer', segmentId: 'seg-1' };
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

const BOARD = uuid(1);
const CARD_A = uuid(2);
const CARD_B = uuid(3);
const EDGE = uuid(4);
const MEDIA = uuid(5);

function ev(
  n: number,
  entityType: string,
  clientEntityId: string,
  payload: unknown,
  dependsOn: string[] = [],
  operation = 'create',
) {
  return {
    eventId: uuid(100 + n),
    clientEntityId,
    entityType,
    operation,
    schemaVersion: 1,
    localSequence: n,
    occurredAt: '2026-01-31T08:00:00.000Z',
    baseVersion: operation === 'create' ? undefined : 1,
    dependsOn,
    destination: DESTINATION,
    payload,
    payloadHash: hashSyncPayload(payload),
  };
}

const boardEvent = () => ev(1, 'canvas-board', BOARD, { title: 'Roadmap', mode: 'chat' });
const cardEvent = (n: number, id: string) => ev(n, 'canvas-object', id, { boardId: BOARD, kind: 'note', canvasData: { x: 1, y: 2 }, content: { title: `card ${n}` } }, [uuid(101)]);
const edgeEvent = () => ev(4, 'canvas-edge', EDGE, { boardId: BOARD, source: CARD_A, target: CARD_B, kind: 'reference', data: { label: 'blocks' } }, [uuid(102), uuid(103)]);
const timelineEvent = () => ev(5, 'canvas-timeline', uuid(6), { boardId: BOARD, clientMessageId: 'm-1', role: 'user', body: 'hello', createdAt: '2026-01-31T08:00:00.000Z' }, [uuid(101)]);
const mediaEvent = () => ev(6, 'canvas-media', MEDIA, {
  boardId: BOARD, objectId: CARD_A, mimeType: 'image/png', bytes: 2048, sha256: 'a'.repeat(64), name: 'logo.png', status: 'local',
}, [uuid(101)]);

const ports: CanvasSyncPorts = {
  sessionQuota: async () => ({ used: 0, limit: -1, allowed: true, currentPlan: 'free' as never }),
  scheduleSnapshot: (_tenantId, sessionId) => async () => { world.snapshots.push(sessionId); },
};

function harness() {
  const tx = dbOf();
  const importers = {
    importSyncedCanvasBoard: (e, c, s) => importSyncedCanvasBoard(e, c, s, tx, ports),
    importSyncedCanvasObject: (e, c, s) => importSyncedCanvasObject(e, c, s, tx, ports),
    importSyncedCanvasEdge: (e, c, s) => importSyncedCanvasEdge(e, c, s, tx, ports),
    importSyncedCanvasTimeline: (e, c, s) => importSyncedCanvasTimeline(e, c, s, tx),
    importSyncedCanvasMedia: (e, c, s) => importSyncedCanvasMedia(e, c, s, tx),
  } as unknown as SyncNamedImporters;
  const stores = createMemorySyncStores({ importers, now: () => NOW });
  const push = (events: Array<ReturnType<typeof ev>>) => handleSyncPush({
    batchId: 'batch-1',
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId: 'device-a',
    destination: DESTINATION,
    events,
  }, { auth: AUTH, now: NOW, stores });
  return { stores, push };
}

const statuses = (response: Awaited<ReturnType<ReturnType<typeof harness>['push']>>) =>
  response.ok ? response.receipts.map((r) => r.status) : [];

beforeEach(() => {
  world.boards.clear();
  world.edits.length = 0;
  world.keys.clear();
  world.timeline.clear();
  world.snapshots.length = 0;
  world.explodeOn.clear();
});

describe('handleSyncPush — canvas entities', () => {
  it('accepts a board, its objects, an edge, a transcript message and a media manifest in dependency order', async () => {
    const h = harness();
    const response = await h.push([boardEvent(), cardEvent(2, CARD_A), cardEvent(3, CARD_B), edgeEvent(), timelineEvent(), mediaEvent()]);
    expect(statuses(response)).toEqual(Array(6).fill('accepted'));
    expect(h.stores.state().mappings.map((m) => m.entityType).sort()).toEqual([
      'canvas-board', 'canvas-edge', 'canvas-media', 'canvas-object', 'canvas-object', 'canvas-timeline',
    ]);
    expect(world.edits).toEqual(['object.created', 'object.created', 'connection.created']);
    // The board is the receipt's server id (the client uuid is never re-keyed).
    expect(response.ok && response.receipts[0]).toMatchObject({ serverId: BOARD, serverVersion: 1 });
  });

  it('refuses a viewer’s write with a code and writes nothing', async () => {
    world.boards.set(BOARD, { tenantId: 7, status: 'active', roles: { 'user-7': 'viewer' }, objects: new Set() });
    const h = harness();
    const response = await h.push([cardEvent(2, CARD_A)].map((e) => ({ ...e, dependsOn: [] })));
    expect(response.ok && response.receipts[0]).toMatchObject({ status: 'rejected', detail: 'canvas_board_forbidden' });
    expect(world.edits).toEqual([]);
    expect(h.stores.state().mappings).toEqual([]);
  });

  it('replays a push idempotently: no second write, no second event row', async () => {
    const h = harness();
    const events = [boardEvent(), cardEvent(2, CARD_A)];
    await h.push(events);
    const eventsAfterFirst = h.stores.state().events.length;
    const again = await h.push(events);
    expect(statuses(again).every((s) => s === 'accepted' || s === 'duplicate')).toBe(true);
    expect(world.edits).toEqual(['object.created']);
    expect(h.stores.state().events).toHaveLength(eventsAfterFirst);
  });

  it('holds children as dependency_pending until their board exists, then applies them', async () => {
    const h = harness();
    const child = { ...cardEvent(2, CARD_A), dependsOn: [] };
    const early = await h.push([child]);
    expect(early.ok && early.receipts[0]).toMatchObject({ status: 'dependency_pending', detail: 'canvas_board_pending' });
    expect(h.stores.state().mappings).toEqual([]);

    // A child whose board's create has not been accepted is held before the importer runs.
    const unmet = await h.push([cardEvent(2, CARD_A)]);
    expect(unmet.ok && unmet.receipts[0]).toMatchObject({ status: 'dependency_pending', detail: uuid(101) });

    const landed = await h.push([boardEvent(), child]);
    expect(statuses(landed)).toEqual(['accepted', 'accepted']);
  });

  it('holds an edge until both of its objects exist', async () => {
    const h = harness();
    const response = await h.push([boardEvent(), cardEvent(2, CARD_A), { ...edgeEvent(), dependsOn: [] }]);
    expect(response.ok && response.receipts[2]).toMatchObject({ status: 'dependency_pending', detail: 'canvas_edge_endpoint_pending' });
  });

  it('rolls the WHOLE chunk back when an importer throws', async () => {
    const BROKEN = uuid(50);
    world.boards.set(BROKEN, { tenantId: 7, status: 'active', roles: { 'user-7': 'owner' }, objects: new Set() });
    world.explodeOn.add(BROKEN);
    const h = harness();
    const exploding = ev(2, 'canvas-object', CARD_A, { boardId: BROKEN, kind: 'note' });
    await expect(h.push([boardEvent(), exploding])).rejects.toThrow('db down');
    expect(h.stores.batchRollbacks()).toBe(1);
    expect(h.stores.state().mappings).toEqual([]);
    expect(h.stores.state().events).toEqual([]);
  });
});
