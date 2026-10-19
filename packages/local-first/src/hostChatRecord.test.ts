import { describe, expect, it } from 'vitest';
import { createHostChatLog } from './hostChatRecord.js';
import type { EntityDestination } from './records.js';
import { createMemoryLocalFirstStore, type LocalFirstSnapshot } from './store.js';

const DEVICE = 'device-1';
const CHAT = 'chat-1';
const OTHER = 'chat-2';
const DESTINATION: EntityDestination = {
  kind: 'bound',
  accountId: 'acct-1',
  tenantId: 'tenant-a',
  projectId: 'project-1',
};

describe('host chat record', () => {
  it('keeps chats, turns, runs, steps, and approvals after export and import', async () => {
    const first = createMemoryLocalFirstStore();
    const log = createHostChatLog(first);
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      throw new Error('network_denied');
    }) as typeof fetch;

    try {
      const turn = await log.appendTurn({
        chatId: CHAT,
        id: 'turn-1',
        role: 'user',
        content: 'Persist this locally',
        title: 'Offline chat',
        deviceId: DEVICE,
        destination: DESTINATION,
        occurredAt: '2026-10-19T00:00:00.000Z',
      });
      const run = await log.appendRun({
        chatId: CHAT,
        id: 'run-1',
        turnId: turn.id,
        status: 'running',
        deviceId: DEVICE,
        occurredAt: '2026-10-19T00:01:00.000Z',
      });
      const step = await log.appendStep({
        chatId: CHAT,
        id: 'step-1',
        runId: run.id,
        name: 'read_file',
        kind: 'read',
        deviceId: DEVICE,
        occurredAt: '2026-10-19T00:02:00.000Z',
      });
      const approval = await log.appendApproval({
        chatId: CHAT,
        id: 'approval-1',
        runId: run.id,
        stepId: step.id,
        decision: 'granted',
        subject: 'read_file',
        deviceId: DEVICE,
        occurredAt: '2026-10-19T00:03:00.000Z',
      });

      expect(turn.entityType).toBe('message');
      expect(run.entityType).toBe('execution');
      expect(step.entityType).toBe('step');
      expect(approval.entityType).toBe('approval');
      expect(turn.provenance?.source).toBe('local');
      expect(turn.payload.lineage).toEqual({ chatId: CHAT });
      expect(run.payload.lineage).toEqual({ chatId: CHAT, turnId: 'turn-1', parentId: 'turn-1' });
      expect(step.payload.lineage).toEqual({ chatId: CHAT, runId: 'run-1', parentId: 'run-1', turnId: 'turn-1' });
      expect(approval.payload.lineage).toEqual({
        chatId: CHAT,
        runId: 'run-1',
        stepId: 'step-1',
        parentId: 'step-1',
      });
      expect(turn.destination).toEqual(DESTINATION);
      expect(approval.destination).toEqual(DESTINATION);

      // A later append cannot re-bind the chat's destination snapshot.
      const rebound = await log.appendRun({
        chatId: CHAT,
        id: 'run-2',
        destination: { kind: 'unbound' },
        deviceId: DEVICE,
      });
      expect(rebound.destination).toEqual(DESTINATION);
    } finally {
      globalThis.fetch = original;
    }

    expect(calls).toEqual([]);
    const exported = await first.export();
    expect(exported.events).toEqual([]);
    expect(exported.receipts).toEqual([]);

    const snapshot = JSON.parse(JSON.stringify(exported)) as LocalFirstSnapshot;
    const reopened = createMemoryLocalFirstStore(snapshot);
    const restored = createHostChatLog(reopened);
    const listed = await restored.list(CHAT);

    expect(listed.chat).toEqual(expect.objectContaining({
      id: CHAT,
      entityType: 'chat',
      payload: { title: 'Offline chat', lineage: { chatId: CHAT } },
    }));
    expect(listed.turns.map((row) => row.id)).toEqual(['turn-1']);
    expect(listed.turns[0]?.payload).toEqual({
      chatId: CHAT,
      role: 'user',
      content: 'Persist this locally',
      seq: 1,
      lineage: { chatId: CHAT },
    });
    expect(listed.runs.map((row) => [row.id, row.payload.seq, row.payload.status])).toEqual([
      ['run-1', 1, 'running'],
      ['run-2', 2, 'queued'],
    ]);
    expect(listed.steps.map((row) => row.payload.name)).toEqual(['read_file']);
    expect(listed.approvals.map((row) => row.payload.decision)).toEqual(['granted']);
    expect(listed.records.map((row) => row.id)).toEqual([CHAT, 'turn-1', 'run-1', 'run-2', 'step-1', 'approval-1']);
    expect(await restored.list(OTHER)).toEqual({
      chatId: OTHER,
      chat: undefined,
      turns: [],
      runs: [],
      steps: [],
      approvals: [],
      records: [],
    });
  });

  it('writes nothing when the chat id is blank or a step names a missing run', async () => {
    const store = createMemoryLocalFirstStore();
    const log = createHostChatLog(store);
    await log.appendTurn({
      chatId: OTHER,
      id: 'turn-other',
      role: 'user',
      content: 'keep me',
      deviceId: DEVICE,
      occurredAt: '2026-10-19T00:00:00.000Z',
    });
    const before = await store.export();

    await expect(log.appendTurn({
      chatId: '   ',
      id: 'turn-blank',
      role: 'user',
      content: 'no',
      deviceId: DEVICE,
    })).rejects.toThrow('chat_id_required');

    await expect(log.appendStep({
      chatId: CHAT,
      id: 'step-missing',
      runId: 'missing-run',
      name: 'shell',
      deviceId: DEVICE,
    })).rejects.toThrow('run_not_found');

    await expect(log.appendApproval({
      chatId: CHAT,
      id: 'approval-orphan',
      decision: 'granted',
      deviceId: DEVICE,
    })).rejects.toThrow('approval_parent_required');

    expect(await store.export()).toEqual(before);
    expect((await store.export()).records.some((row) => row.id === 'step-missing' || row.id === CHAT)).toBe(false);
    expect((await store.export()).events).toEqual([]);
  });
});
