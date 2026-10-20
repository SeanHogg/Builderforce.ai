import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TRANSACTIONAL_SNAPSHOT_INVALID,
  createTransactionalRecordStore,
  decodeTransactionalSnapshot,
  openTransactionalRecordStoreFromBytes,
  type CommitTransactionalRecordInput,
  type TransactionalCommitStep,
} from './transactionalRecord.js';

const DEVICE = 'device-1';
const AT = '2026-10-19T09:00:00.000Z';
const BOUND = { kind: 'bound', platformInstance: 'platform-1', accountId: 'acct-1', tenantId: 'ten-1' } as const;

function commitInput(overrides: Partial<CommitTransactionalRecordInput> = {}): CommitTransactionalRecordInput {
  return {
    deviceId: DEVICE,
    occurredAt: AT,
    destination: BOUND,
    project: { id: 'project-1', name: 'Offline board', key: 'OFF' },
    ticket: { id: 'ticket-1', title: 'Survives a restart', status: 'backlog' },
    chat: { id: 'chat-1', title: 'Offline chat' },
    audit: { id: 'audit-1', auditKey: 'soc2-readiness', status: 'running' },
    run: { id: 'run-1', status: 'queued' },
    ...overrides,
  };
}

const bytesOf = (value: Uint8Array): string => new TextDecoder().decode(value);

describe('transactional record store', () => {
  it('commits chat, project, ticket, audit, and run in one transaction', async () => {
    const store = createTransactionalRecordStore();
    const commit = await store.commit(commitInput());

    expect(commit.project.entityType).toBe('project');
    expect(commit.ticket.entityType).toBe('ticket');
    expect(commit.chat.entityType).toBe('chat');
    expect(commit.audit.entityType).toBe('audit-run');
    expect(commit.run.entityType).toBe('execution');

    const listing = await store.list();
    expect(listing.projects.map((r) => r.id)).toEqual(['project-1']);
    expect(listing.tickets.map((r) => r.id)).toEqual(['ticket-1']);
    expect(listing.chats.map((r) => r.id)).toEqual(['chat-1']);
    expect(listing.audits.map((r) => r.id)).toEqual(['audit-1']);
    expect(listing.runs.map((r) => r.id)).toEqual(['run-1']);

    // Every record carries one destination snapshot, one device, one timestamp.
    for (const record of [commit.project, commit.ticket, commit.chat, commit.audit, commit.run]) {
      expect(record.destination).toEqual(BOUND);
      expect(record.provenance?.deviceId).toBe(DEVICE);
      expect(record.provenance?.source).toBe('local');
      expect(record.occurredAt).toBe(AT);
      expect(record.updatedAt).toBe(AT);
    }
  });

  it('writes a create event per record, in dependency order, sharing one commit', async () => {
    const store = createTransactionalRecordStore();
    const commit = await store.commit(commitInput());

    expect(commit.events.map((event) => event.entityType)).toEqual([
      'project',
      'ticket',
      'chat',
      'audit-run',
      'execution',
    ]);
    // One transaction, so the five events hold five consecutive sequences.
    const sequences = commit.events.map((event) => event.localSequence);
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
    expect(commit.firstSequence).toBe(1);
    // The ticket depends on the project; the run on the chat and the audit.
    expect(commit.events[1].dependsOn).toEqual(['project:project-1:v1']);
    expect(commit.events[4].dependsOn).toEqual(['chat:chat-1:v1', 'audit-run:audit-1:v1']);
    for (const event of commit.events) expect(event.operation).toBe('create');
  });

  it('snapshots lineage on the chat and the ticket, not in memory', async () => {
    const store = createTransactionalRecordStore();
    const commit = await store.commit(commitInput());

    expect(commit.chat.payload.lineage).toEqual({
      chatId: 'chat-1',
      projectId: 'project-1',
      ticketId: 'ticket-1',
    });
    expect(commit.ticket.payload.projectId).toBe('project-1');
    expect(commit.audit.payload).toEqual(expect.objectContaining({
      auditKey: 'soc2-readiness',
      projectId: 'project-1',
      ticketId: 'ticket-1',
      status: 'running',
    }));
    expect(commit.run.payload).toEqual({ chatId: 'chat-1', ticketId: 'ticket-1', status: 'queued' });
  });

  it('reads every record back after a restart from committed bytes, with no API', async () => {
    const first = createTransactionalRecordStore();
    await first.commit(commitInput());

    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      throw new Error('network_denied');
    }) as typeof fetch;

    try {
      const restarted = openTransactionalRecordStoreFromBytes(await first.exportSnapshotBytes());
      const listing = await restarted.list();

      expect(listing.projects).toHaveLength(1);
      expect(listing.tickets).toHaveLength(1);
      expect(listing.chats).toHaveLength(1);
      expect(listing.audits).toHaveLength(1);
      expect(listing.runs).toHaveLength(1);
      expect(calls).toEqual([]);

      expect(listing.chats[0].payload.title).toBe('Offline chat');
      expect(listing.tickets[0].payload.title).toBe('Survives a restart');
      expect(listing.runs[0].payload.status).toBe('queued');
      expect(listing.audits[0].payload.status).toBe('running');
      // The destination snapshot survives the restart, so a later sign-in
      // cannot redirect this work.
      expect(listing.projects[0].destination).toEqual(BOUND);
      expect(await restarted.get('chat', 'chat-1')).toEqual(listing.chats[0]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('carries the restart across two commits and a closed audit', async () => {
    const first = createTransactionalRecordStore();
    await first.commit(commitInput());
    const bytes = await first.exportSnapshotBytes();

    const restarted = openTransactionalRecordStoreFromBytes(bytes);
    const second = await restarted.commit(commitInput({
      project: { id: 'project-2', name: 'Second board' },
      ticket: { id: 'ticket-2', title: 'Second ticket' },
      chat: { id: 'chat-2' },
      audit: { id: 'audit-2', auditKey: 'privacy', status: 'completed' },
      run: { id: 'run-2', status: 'completed', checkpoint: { step: 3, safeToResume: true } },
    }));

    expect(second.audit.payload.closedAt).toBe(AT);
    expect(second.run.payload.checkpoint).toEqual({ step: 3, safeToResume: true });

    const third = openTransactionalRecordStoreFromBytes(await restarted.exportSnapshotBytes());
    const listing = await third.list();
    expect(listing.projects.map((r) => r.id)).toEqual(['project-1', 'project-2']);
    expect(listing.tickets.map((r) => r.id)).toEqual(['ticket-1', 'ticket-2']);
    expect(listing.chats.map((r) => r.id)).toEqual(['chat-1', 'chat-2']);
    expect(listing.audits.map((r) => r.id)).toEqual(['audit-1', 'audit-2']);
    expect(listing.runs.map((r) => r.id)).toEqual(['run-1', 'run-2']);
    // Sequence allocation continues across the restart.
    expect(listing.events.map((event) => event.localSequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('leaves the previous snapshot unchanged when the commit throws mid-way', async () => {
    for (const failAt of ['project', 'ticket', 'chat', 'audit', 'run', 'events'] as TransactionalCommitStep[]) {
      // Seed one good commit, then fault on a second, failing commit.
      const seeded = createTransactionalRecordStore();
      await seeded.commit(commitInput());
      const before = await seeded.exportSnapshotBytes();
      const beforeListing = await seeded.list();

      const failing = createTransactionalRecordStore({
        initial: decodeTransactionalSnapshot(before),
        onStep: (step) => {
          if (step === failAt) throw new Error(`fault_at_${failAt}`);
        },
      });
      await expect(
        failing.commit(commitInput({
          project: { id: 'project-2', name: 'Never committed' },
          ticket: { id: 'ticket-2', title: 'Never committed' },
          chat: { id: 'chat-2' },
          audit: { id: 'audit-2', auditKey: 'privacy' },
          run: { id: 'run-2' },
        })),
      ).rejects.toThrow(`fault_at_${failAt}`);

      const after = await failing.exportSnapshotBytes();
      expect(bytesOf(after)).toBe(bytesOf(before));
      const afterListing = await failing.list();
      expect(afterListing.projects).toEqual(beforeListing.projects);
      expect(afterListing.tickets).toEqual(beforeListing.tickets);
      expect(afterListing.chats).toEqual(beforeListing.chats);
      expect(afterListing.audits).toEqual(beforeListing.audits);
      expect(afterListing.runs).toEqual(beforeListing.runs);
      expect(afterListing.events).toEqual(beforeListing.events);
      expect(await failing.get('project', 'project-2')).toBeUndefined();
    }
  });

  it('commits nothing when validation fails before the transaction opens', async () => {
    const store = createTransactionalRecordStore();
    await store.commit(commitInput());
    const before = await store.exportSnapshotBytes();

    const refusals: Array<[Partial<CommitTransactionalRecordInput>, string]> = [
      [{ deviceId: '  ' }, 'device_id_required'],
      [{ project: { name: '' } }, 'project_name_required'],
      [{ ticket: { title: '   ' } }, 'ticket_title_required'],
      [{ audit: { auditKey: '' } }, 'audit_key_required'],
      [{ chat: { id: ' ' } }, 'client_entity_id_must_be_stable_uuid'],
    ];
    for (const [overrides, code] of refusals) {
      await expect(store.commit(commitInput(overrides))).rejects.toThrow(code);
    }
    expect(bytesOf(await store.exportSnapshotBytes())).toBe(bytesOf(before));
    expect((await store.list()).projects).toHaveLength(1);
  });

  it('exports identical bytes for identical state and rejects corrupt bytes', () => {
    const store = createTransactionalRecordStore();
    return store.commit(commitInput()).then(() => {
      const a = store.exportSnapshotBytes();
      const b = store.exportSnapshotBytes();
      return Promise.all([a, b]).then(([first, second]) => {
        expect(bytesOf(first)).toBe(bytesOf(second));
        const round = decodeTransactionalSnapshot(first);
        expect(round.records).toHaveLength(5);
        expect(round.events).toHaveLength(5);
        expect(round.nextSequence).toBe(6);
        expect(() => decodeTransactionalSnapshot(new TextEncoder().encode('{ not json'))).toThrow(
          TRANSACTIONAL_SNAPSHOT_INVALID,
        );
        expect(() => decodeTransactionalSnapshot(new TextEncoder().encode('{"records":[]}'))).toThrow(
          TRANSACTIONAL_SNAPSHOT_INVALID,
        );
      });
    });
  });

  it('opens no file and imports no network client', () => {
    const source = readFileSync(new URL('./transactionalRecord.ts', import.meta.url), 'utf8');
    // Comment-only prose may name the live snapshot; executable code may not.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/node:fs/);
    expect(code).not.toMatch(/local-first-v1/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\bXMLHttpRequest\b/);
    expect(code).not.toMatch(/node:https?/);
    expect(code).not.toMatch(/readFile|writeFile|rename/);
  });

  it('leaves the VSIX JSON snapshot as a cache, not the live store', () => {
    const vsix = readFileSync(
      new URL('../../../clients/vscode/src/localFirstStore.ts', import.meta.url),
      'utf8',
    );
    // The corrupt-file recovery helpers still read the legacy file.
    expect(vsix).toContain('"local-first-v1.json"');
    expect(vsix).toContain('createMemoryLocalFirstStore');
    // G03: the host's `localBrainApplication` is wired to the journal-backed
    // store, so the JSON file is republished from it and is never read back
    // as state. This module is still not the host's store.
    expect(vsix).not.toContain('transactionalRecord');
    expect(vsix).toContain('createOfflineLocalFirstStore');
    expect(vsix).toMatch(/const store = createOfflineLocalFirstStore\(\{/);
  });
});