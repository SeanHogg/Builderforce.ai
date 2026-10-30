import { describe, expect, it, vi } from 'vitest';
import { destinationKey } from '@builderforce/local-first';
import { createMemoryOutboxStore, createOnlineSignal } from '@builderforce/write-outbox';
import type { ApiClient, ApiRequestInit } from '../api/apiClient';
import { createMemoryRecords, type LocalTask } from '../store/records';
import { createChatSync, type SyncItem } from './chatSync';

interface Call {
  path: string;
  init: ApiRequestInit;
}

function fakeApi(opts: { failMessagesOnce?: boolean } = {}): ApiClient & { calls: Call[] } {
  const calls: Call[] = [];
  let failNext = opts.failMessagesOnce ?? false;
  return {
    calls,
    async request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
      calls.push({ path, init });
      if (path === '/api/brain/chats') return { id: 501 } as T;
      if (path === '/api/tasks') return { id: 9001 } as T;
      if (path.endsWith('/messages') && failNext) {
        failNext = false;
        throw new Error('network down'); // no status: retried
      }
      return {} as T;
    },
    async raw() {
      return { status: 200, body: {} };
    },
  };
}

async function setup(opts: { scope?: string | null; projectId?: number | null; failMessagesOnce?: boolean; taskProjectId?: () => Promise<number | null> } = {}) {
  const records = createMemoryRecords();
  const chat = await records.createChat('Plan the trip');
  const api = fakeApi(opts);
  let scope: string | null = opts.scope === undefined ? 'tenant:3' : opts.scope;
  const online = createOnlineSignal(true);
  const sync = createChatSync({
    api,
    records,
    store: createMemoryOutboxStore<SyncItem, number>(),
    online,
    scope: () => scope,
    taskProjectId: opts.taskProjectId ?? (async () => (opts.projectId === undefined ? 42 : opts.projectId)),
  });
  return { records, chat, api, sync, online, setScope: (s: string | null) => (scope = s) };
}

const task = (chatId: number, id = 'task-1'): LocalTask => ({ id, chatId, title: 'Book flights', description: '', createdAt: '', state: 'queued' });

describe('chat sync outbox', () => {
  it('creates the platform chat once, then posts rows with replay-safe event keys, as the workspace they were written in', async () => {
    const { sync, chat, api, records } = await setup();
    sync.enqueue(chat.id, { kind: 'message', row: { role: 'user', content: 'hi' } });
    sync.enqueue(chat.id, { kind: 'message', row: { role: 'assistant', content: 'hello' } });
    await sync.flush();

    expect(api.calls.map((c) => c.path)).toEqual(['/api/brain/chats', '/api/brain/chats/501/messages']);
    expect(api.calls[0]!.init).toMatchObject({ method: 'POST', json: { title: 'Plan the trip', mode: 'chat' }, asScope: 'tenant:3' });
    expect(api.calls[0]!.init.idempotencyKey).toBe(`rovr-chat:${chat.syncKey}`);
    const rows = (api.calls[1]!.init.json as { messages: Array<{ content: string; eventKey: string }> }).messages;
    expect(rows.map((r) => r.content)).toEqual(['hi', 'hello']);
    expect(rows.every((r) => r.eventKey.startsWith('rovr:'))).toBe(true);
    expect(new Set(rows.map((r) => r.eventKey)).size).toBe(2);
    expect(api.calls[1]!.init.asScope).toBe('tenant:3');
    expect((await records.getChat(chat.id))?.serverId).toBe(501);

    sync.enqueue(chat.id, { kind: 'message', row: { role: 'user', content: 'again' } });
    await sync.flush();
    expect(api.calls.filter((c) => c.path === '/api/brain/chats')).toHaveLength(1);
  });

  it('sends a row under ITS OWN key when it has one, so the server upserts a late save and its retry as one row', async () => {
    const { sync, chat, api } = await setup();
    sync.enqueue(chat.id, { kind: 'message', row: { role: 'user', content: 'keyed', eventKey: 'steer:abc' } });
    sync.enqueue(chat.id, { kind: 'message', row: { role: 'user', content: 'unkeyed' } });
    await sync.flush();

    const rows = (api.calls.find((c) => c.path.endsWith('/messages'))!.init.json as { messages: Array<{ content: string; eventKey: string }> }).messages;
    expect(rows.find((r) => r.content === 'keyed')?.eventKey).toBe('steer:abc');
    expect(rows.find((r) => r.content === 'unkeyed')?.eventKey.startsWith('rovr:')).toBe(true);
  });

  it('holds writes made signed out, and sends them once there is a workspace', async () => {
    const { sync, chat, api, setScope } = await setup({ scope: null });
    sync.enqueue(chat.id, { kind: 'message', row: { role: 'user', content: 'offline thought' } });
    await sync.flush();
    expect(api.calls).toHaveLength(0);

    setScope('tenant:8');
    await sync.flush();
    expect(api.calls.map((c) => c.path)).toEqual(['/api/brain/chats', '/api/brain/chats/501/messages']);
    expect(api.calls[1]!.init.asScope).toBe('tenant:8');
  });

  it('waits while offline and replays when the connection returns', async () => {
    const { sync, chat, api, online } = await setup();
    online.set(false);
    sync.enqueue(chat.id, { kind: 'message', row: { role: 'user', content: 'on a plane' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(api.calls).toHaveLength(0);
    online.set(true);
    await sync.flush();
    expect(api.calls.map((c) => c.path)).toContain('/api/brain/chats/501/messages');
  });

  it('keeps a failed batch and retries it without creating the chat twice', async () => {
    const { sync, chat, api } = await setup({ failMessagesOnce: true });
    sync.enqueue(chat.id, { kind: 'message', row: { role: 'user', content: 'hi' } });
    await sync.flush();
    await sync.flush();
    const paths = api.calls.map((c) => c.path);
    expect(paths.filter((p) => p === '/api/brain/chats')).toHaveLength(1);
    expect(paths.filter((p) => p.endsWith('/messages'))).toHaveLength(2);
    const [first, second] = api.calls.filter((c) => c.path.endsWith('/messages'));
    expect(second!.init.json).toEqual(first!.init.json); // same rows, same event keys
  });

  it('files a task in the chosen project and links it to the chat, idempotently, in order', async () => {
    const { sync, chat, api, records } = await setup();
    await records.putTask(task(chat.id));
    sync.enqueue(chat.id, { kind: 'message', row: { role: 'user', content: 'remind me to book flights' } });
    sync.enqueue(chat.id, { kind: 'task', taskId: 'task-1' });
    await sync.flush();

    expect(api.calls.map((c) => c.path)).toEqual([
      '/api/brain/chats',
      '/api/brain/chats/501/messages',
      '/api/tasks',
      '/api/brain/chats/501/tickets',
    ]);
    expect(api.calls[2]!.init.json).toEqual({ projectId: 42, title: 'Book flights' });
    expect(api.calls[2]!.init.idempotencyKey).toBe('rovr-task-create:task-1');
    expect(api.calls[3]!.init).toMatchObject({ json: { kind: 'task', ref: 9001, linkType: 'created' } });
    expect(api.calls[3]!.init.idempotencyKey).toMatch(/^rovr-task:/);
    expect(await records.getTask('task-1')).toMatchObject({ state: 'synced', serverTaskId: 9001 });
  });

  it('keeps a task on the device when no project is chosen', async () => {
    const { sync, chat, api, records } = await setup({ projectId: null });
    await records.putTask(task(chat.id));
    sync.enqueue(chat.id, { kind: 'task', taskId: 'task-1' });
    await sync.flush();
    expect(api.calls.map((c) => c.path)).toEqual(['/api/brain/chats']);
    expect((await records.getTask('task-1'))?.state).toBe('local');
  });

  it('does not move a queued task when Settings changes after enqueue', async () => {
    let live: number | null = 7;
    const lookup = vi.fn(async () => live);
    const { sync, chat, api, records } = await setup({ taskProjectId: lookup });
    await records.putTask(task(chat.id));
    const item: SyncItem = { kind: 'task', taskId: 'task-1' };
    sync.enqueue(chat.id, item);
    const callsAtEnqueue = lookup.mock.calls.length;
    live = 99;
    await sync.flush();

    expect(api.calls.find((c) => c.path === '/api/tasks')?.init.json).toEqual({ projectId: 7, title: 'Book flights' });
    expect(await records.getTask('task-1')).toMatchObject({ projectId: 7, state: 'synced', serverTaskId: 9001 });
    expect(item).toMatchObject({ projectId: 7, destinationKey: destinationKey({ kind: 'bound', projectId: '7' }) });
    // Send reads the snapshot. It does not look Settings up again, so the change is not a rebind.
    expect(lookup.mock.calls.length).toBe(callsAtEnqueue);
    expect(lookup.mock.calls.length).toBeGreaterThan(0);
  });

  it('does not move a record that already has a destination when the live project is read', async () => {
    const lookup = vi.fn(async () => 99);
    const { sync, chat, api, records } = await setup({ taskProjectId: lookup });
    await records.putTask({ ...task(chat.id), projectId: 7 });
    sync.enqueue(chat.id, { kind: 'task', taskId: 'task-1' });
    await sync.flush();

    expect(api.calls.find((c) => c.path === '/api/tasks')?.init.json).toEqual({ projectId: 7, title: 'Book flights' });
    expect((await records.getTask('task-1'))?.projectId).toBe(7);
  });

  it('does not treat a live project lookup as a rebind of a task that already has a destination', async () => {
    const lookup = vi.fn(async () => 99);
    const { sync, chat, api, records } = await setup({ taskProjectId: lookup });
    await records.putTask({ ...task(chat.id), projectId: 7 });
    const item: SyncItem = { kind: 'task', taskId: 'task-1', projectId: 7, destinationKey: destinationKey({ kind: 'bound', projectId: '7' }) };
    sync.enqueue(chat.id, item);
    await sync.flush();

    expect(lookup).not.toHaveBeenCalled();
    expect(api.calls.find((c) => c.path === '/api/tasks')?.init.json).toEqual({ projectId: 7, title: 'Book flights' });
    expect((await records.getTask('task-1'))?.projectId).toBe(7);
    expect(item.kind === 'task' && item.destinationKey).toBe(destinationKey({ kind: 'bound', projectId: '7' }));
  });

  it('keeps an unbound snapshot unbound when Settings later picks a project', async () => {
    let live: number | null = null;
    const lookup = vi.fn(async () => live);
    const { sync, chat, api, records } = await setup({ taskProjectId: lookup });
    await records.putTask(task(chat.id));
    const item: SyncItem = { kind: 'task', taskId: 'task-1' };
    sync.enqueue(chat.id, item);
    live = 99;
    await sync.flush();

    expect(api.calls.map((c) => c.path)).toEqual(['/api/brain/chats']);
    expect(await records.getTask('task-1')).toMatchObject({ projectId: null, state: 'local' });
    expect(item).toMatchObject({ projectId: null, destinationKey: destinationKey({ kind: 'unbound' }) });
  });
});
