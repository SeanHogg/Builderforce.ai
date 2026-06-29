import { describe, expect, it, vi } from 'vitest';
import {
  SyncEngine,
  computeBackoffMs,
  type BoardSyncStore,
  type StoredConnection,
  type StoredLink,
  type OutboxRow,
  type UpsertLinkInput,
  type UpsertTaskInput,
  type TypeMapping,
} from './SyncEngine';
import type { BoardProvider, NormalizedTicket, ChangeSet } from './providers';
import { hashFields } from './reconciler';

// ---------------------------------------------------------------------------
// In-memory fake store (no real DB)
// ---------------------------------------------------------------------------

function makeStore(conn: StoredConnection): {
  store: BoardSyncStore;
  links: Map<string, StoredLink>;
  tasks: number[];
  taskInserts: UpsertTaskInput[];
  typeMappings: TypeMapping[];
  logs: Array<{ status: string; itemsProcessed: number; itemsErrored: number }>;
  cursor: { value: string | null };
  outbox: OutboxRow[];
  outboxState: Map<string, string>;
} {
  const links = new Map<string, StoredLink>();
  const tasks: number[] = [];
  const taskInserts: UpsertTaskInput[] = [];
  const typeMappings: TypeMapping[] = [];
  const logs: Array<{ status: string; itemsProcessed: number; itemsErrored: number }> = [];
  const cursor = { value: conn.pollCursor };
  let taskSeq = 100;
  let linkSeq = 1;
  const outbox: OutboxRow[] = [];
  const outboxState = new Map<string, string>();

  const store: BoardSyncStore = {
    async getConnection() {
      return { ...conn, pollCursor: cursor.value };
    },
    async getLink(_c, externalId) {
      return links.get(externalId) ?? null;
    },
    async listTypeMappings() {
      return typeMappings;
    },
    async upsertLink(input: UpsertLinkInput) {
      const existing = links.get(input.externalId);
      const link: StoredLink = {
        id: existing?.id ?? `link-${linkSeq++}`,
        connectionId: input.connectionId,
        taskId: input.taskId,
        externalId: input.externalId,
        externalVersion: input.externalVersion,
        contentHash: input.contentHash,
        syncState: input.syncState,
        fields: input.fields,
      };
      links.set(input.externalId, link);
      return link;
    },
    async upsertTask(input: UpsertTaskInput) {
      taskInserts.push(input);
      if (input.existingTaskId != null) return input.existingTaskId;
      const id = taskSeq++;
      tasks.push(id);
      return id;
    },
    async setLinkTask(linkId, taskId) {
      for (const l of links.values()) if (l.id === linkId) l.taskId = taskId;
    },
    async advanceCursor(_c, value) {
      cursor.value = value;
    },
    async writeSyncLog(input) {
      logs.push({ status: input.status, itemsProcessed: input.itemsProcessed, itemsErrored: input.itemsErrored });
    },
    async listPendingOutbox() {
      return outbox.filter((o) => (outboxState.get(o.id) ?? 'pending') === 'pending');
    },
    async markOutboxDone(id) {
      outboxState.set(id, 'done');
    },
    async markOutboxRetry(id) {
      outboxState.set(id, 'pending');
    },
    async markOutboxDead(id) {
      outboxState.set(id, 'dead');
    },
  };

  return { store, links, tasks, taskInserts, typeMappings, logs, cursor, outbox, outboxState };
}

function ticket(num: string, version: string, fields: Record<string, unknown>): NormalizedTicket {
  return {
    externalId: num,
    externalUrl: `https://x/${num}`,
    externalVersion: version,
    title: String(fields.title ?? ''),
    body: String(fields.body ?? ''),
    state: String(fields.state ?? 'open'),
    source: 'github',
    contentHash: hashFields(fields),
    fields,
  };
}

const CONN: StoredConnection = {
  id: 'conn-1',
  tenantId: 42,
  segmentId: null,
  projectId: 7,
  provider: 'github',
  pollCursor: null,
};

function fakeProvider(page: { tickets: NormalizedTicket[]; nextCursor: string | null }): BoardProvider {
  return {
    id: 'github',
    async fetchTicketsSince() {
      return page;
    },
    async pushUpdate() {
      /* noop */
    },
  };
}

describe('SyncEngine.syncConnection — happy path', () => {
  it('reconciles each ticket, creates BF tasks, advances cursor, writes a success log', async () => {
    const f1 = { title: 'A', body: 'a', state: 'open' };
    const f2 = { title: 'B', body: 'b', state: 'open' };
    const page = {
      tickets: [ticket('1', 'v1', f1), ticket('2', 'v1', f2)],
      nextCursor: 'cursor-after',
    };
    const { store, links, tasks, logs, cursor } = makeStore(CONN);
    const engine = new SyncEngine(store, () => fakeProvider(page));

    const result = await engine.syncConnection('conn-1');

    expect(result.processed).toBe(2);
    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.conflicts).toBe(0);
    expect(result.errored).toBe(0);
    expect(tasks).toHaveLength(2);
    expect(links.size).toBe(2);
    expect(links.get('1')?.taskId).not.toBeNull();
    expect(cursor.value).toBe('cursor-after');
    expect(logs).toEqual([{ status: 'success', itemsProcessed: 2, itemsErrored: 0 }]);
  });

  it('is idempotent: a second identical sync applies nothing new', async () => {
    const fields = { title: 'A', body: 'a', state: 'open' };
    const page = { tickets: [ticket('1', 'v1', fields)], nextCursor: 'c1' };
    const { store, tasks } = makeStore(CONN);
    const engine = new SyncEngine(store, () => fakeProvider(page));

    const first = await engine.syncConnection('conn-1');
    expect(first.applied).toBe(1);
    expect(tasks).toHaveLength(1);

    const second = await engine.syncConnection('conn-1');
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(1);
    expect(tasks).toHaveLength(1); // no duplicate task
  });

  it('writes an error log and rethrows when the provider fetch fails', async () => {
    const { store, logs } = makeStore(CONN);
    const failing: BoardProvider = {
      id: 'github',
      async fetchTicketsSince() {
        throw new Error('network down');
      },
      async pushUpdate() {},
    };
    const engine = new SyncEngine(store, () => failing);
    await expect(engine.syncConnection('conn-1')).rejects.toThrow('network down');
    expect(logs[0]!.status).toBe('error');
  });
});

describe('SyncEngine.drainOutbox', () => {
  it('pushes pending rows and marks them done', async () => {
    const ctx = makeStore(CONN);
    ctx.outbox.push({ id: 'o1', connectionId: 'conn-1', externalId: '1', taskId: 100, changeSet: { title: 'x' } as ChangeSet, attempts: 0 });
    const push = vi.fn(async () => {});
    const provider: BoardProvider = { id: 'github', async fetchTicketsSince() { return { tickets: [], nextCursor: null }; }, pushUpdate: push };
    const engine = new SyncEngine(ctx.store, () => provider);

    const r = await engine.drainOutbox('conn-1');
    expect(push).toHaveBeenCalledWith('1', { title: 'x' });
    expect(r.succeeded).toBe(1);
    expect(ctx.outboxState.get('o1')).toBe('done');
  });

  it('retries with backoff on failure below the attempt cap', async () => {
    const ctx = makeStore(CONN);
    ctx.outbox.push({ id: 'o1', connectionId: 'conn-1', externalId: '1', taskId: 100, changeSet: { title: 'x' } as ChangeSet, attempts: 0 });
    const provider: BoardProvider = {
      id: 'github',
      async fetchTicketsSince() { return { tickets: [], nextCursor: null }; },
      async pushUpdate() { throw new Error('429'); },
    };
    const engine = new SyncEngine(ctx.store, () => provider);
    const r = await engine.drainOutbox('conn-1');
    expect(r.retried).toBe(1);
    expect(ctx.outboxState.get('o1')).toBe('pending');
  });

  it('marks a row dead once it exceeds the attempt cap', async () => {
    const ctx = makeStore(CONN);
    ctx.outbox.push({ id: 'o1', connectionId: 'conn-1', externalId: '1', taskId: 100, changeSet: {} as ChangeSet, attempts: 5 });
    const provider: BoardProvider = {
      id: 'github',
      async fetchTicketsSince() { return { tickets: [], nextCursor: null }; },
      async pushUpdate() { throw new Error('still failing'); },
    };
    const engine = new SyncEngine(ctx.store, () => provider);
    const r = await engine.drainOutbox('conn-1');
    expect(r.dead).toBe(1);
    expect(ctx.outboxState.get('o1')).toBe('dead');
  });
});

describe('SyncEngine type mapping (board_type_mappings)', () => {
  it('applies the mapped task_type/status on a NEW task, but not on update', async () => {
    const f = { title: 'A', body: 'a', state: 'open' };
    const page = { tickets: [{ ...ticket('1', 'v1', f), externalType: 'Epic' }], nextCursor: 'c1' };
    const ctx = makeStore(CONN);
    ctx.typeMappings.push({ externalType: 'Epic', targetTaskType: 'epic', targetStatus: 'in_progress' });
    const engine = new SyncEngine(ctx.store, () => fakeProvider(page));

    await engine.syncConnection('conn-1');
    const insert = ctx.taskInserts.find((t) => t.existingTaskId == null);
    expect(insert?.taskType).toBe('epic');
    expect(insert?.status).toBe('in_progress');

    // A second sync with an advanced version updates the SAME task and must NOT
    // re-apply the mapping (no status reset on a board move).
    const page2 = { tickets: [{ ...ticket('1', 'v2', { ...f, body: 'changed' }), externalType: 'Epic' }], nextCursor: 'c2' };
    const engine2 = new SyncEngine(ctx.store, () => fakeProvider(page2));
    await engine2.syncConnection('conn-1');
    const update = ctx.taskInserts.find((t) => t.existingTaskId != null);
    expect(update?.taskType ?? null).toBeNull();
    expect(update?.status ?? null).toBeNull();
  });

  it('leaves task_type/status unset when no mapping matches', async () => {
    const page = { tickets: [{ ...ticket('9', 'v1', { title: 'X' }), externalType: 'Bug' }], nextCursor: 'c1' };
    const ctx = makeStore(CONN);
    const engine = new SyncEngine(ctx.store, () => fakeProvider(page));
    await engine.syncConnection('conn-1');
    const insert = ctx.taskInserts[0];
    expect(insert?.taskType ?? null).toBeNull();
    expect(insert?.status ?? null).toBeNull();
  });
});

describe('computeBackoffMs', () => {
  it('grows exponentially and caps at 1h', () => {
    expect(computeBackoffMs(1)).toBe(2000);
    expect(computeBackoffMs(2)).toBe(4000);
    expect(computeBackoffMs(100)).toBe(60 * 60 * 1000);
  });
});
