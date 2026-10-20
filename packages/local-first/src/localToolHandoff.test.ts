import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_TOOL_REFUSED,
  TOOL_NAME_REQUIRED,
  enqueueLocalTool,
  handoff,
  refusesPlatform,
  type QueuedLocalToolCall,
} from './localToolHandoff.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kept(): QueuedLocalToolCall {
  return Object.freeze({
    id: 'kept',
    name: 'project-create',
    args: Object.freeze({ name: 'Board' }),
    status: 'queued' as const,
  });
}

describe('local tool handoff', () => {
  it('queues a local tool call and returns it', () => {
    const queue: QueuedLocalToolCall[] = [];
    const args = { title: 'Offline ticket' };
    const queued = enqueueLocalTool(queue, { id: 'call-1', name: 'ticket-create', args });

    expect(queued).toEqual({
      id: 'call-1',
      name: 'ticket-create',
      args: { title: 'Offline ticket' },
      status: 'queued',
    });
    expect(queue).toEqual([queued]);
    expect(queue[0]).toBe(queued);
    expect(Object.isFrozen(queued)).toBe(true);
    args.title = 'mutated';
    expect(queued.args).toEqual({ title: 'Offline ticket' });
  });

  it('assigns an id when the call does not have one', () => {
    const queue: QueuedLocalToolCall[] = [];
    const queued = enqueueLocalTool(queue, { name: 'memory-recall', args: { query: 'G06' } });
    expect(queued.id).toMatch(UUID);
    expect(queued.status).toBe('queued');
    expect(queued.args).toEqual({ query: 'G06' });
    expect(queue).toHaveLength(1);
  });

  it('assigns an id when the supplied id is blank', () => {
    const queue: QueuedLocalToolCall[] = [];
    const queued = enqueueLocalTool(queue, { id: '   ', name: 'memory-recall' });
    expect(queued.id).toMatch(UUID);
    expect(queued.args).toEqual({});
  });

  it('appends instead of replacing an earlier call', () => {
    const queue: QueuedLocalToolCall[] = [];
    const first = enqueueLocalTool(queue, { id: 'a', name: 'project-create', args: { name: 'Board' } });
    const second = enqueueLocalTool(queue, { id: 'b', name: 'ticket-create', args: {} });
    expect(queue).toEqual([first, second]);
  });

  it('throws tool_name_required for an empty name and writes nothing', () => {
    const existing = kept();
    const queue: QueuedLocalToolCall[] = [existing];

    for (const name of ['', '   ']) {
      expect(() => enqueueLocalTool(queue, { id: 'bad', name, args: { leaked: true } })).toThrow(TOOL_NAME_REQUIRED);
      try {
        enqueueLocalTool(queue, { id: 'bad', name, args: { leaked: true } });
        expect.unreachable('empty name must throw');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(TOOL_NAME_REQUIRED);
        expect((error as { code?: string }).code).toBe(TOOL_NAME_REQUIRED);
      }
    }

    expect(queue).toEqual([existing]);
    expect(queue[0]).toBe(existing);
    expect(queue.some((entry) => entry.id === 'bad')).toBe(false);
  });

  it('still appends a later valid call after a rejected empty name', () => {
    const queue: QueuedLocalToolCall[] = [];
    expect(() => enqueueLocalTool(queue, { name: '' })).toThrow(TOOL_NAME_REQUIRED);
    const queued = enqueueLocalTool(queue, { id: 'ok', name: 'ticket-create', args: { title: 'Kept' } });
    expect(queue).toEqual([queued]);
  });

  it('hands queued calls to sync without changing the original queue', () => {
    const queue: QueuedLocalToolCall[] = [];
    const first = enqueueLocalTool(queue, { id: 'a', name: 'project-create', args: { name: 'Board' } });
    const second = enqueueLocalTool(queue, { id: 'b', name: 'ticket-create', args: { title: 'One' } });
    const before = queue.map((entry) => ({ ...entry, args: { ...entry.args } }));

    const handed = handoff(queue);

    expect(handed).toEqual([
      { id: 'a', name: 'project-create', args: { name: 'Board' }, status: 'handed_off' },
      { id: 'b', name: 'ticket-create', args: { title: 'One' }, status: 'handed_off' },
    ]);
    expect(handed[0]).not.toBe(first);
    expect(handed[1]).not.toBe(second);
    expect(handed[0]?.args).not.toBe(first.args);
    expect(queue).toEqual(before);
    expect(queue[0]).toBe(first);
    expect(queue[1]).toBe(second);
    expect(queue.every((entry) => entry.status === 'queued')).toBe(true);
    expect(Object.isFrozen(handed)).toBe(true);
    expect(Object.isFrozen(handed[0])).toBe(true);
  });

  it('returns only queued calls and leaves already handed-off entries in place', () => {
    const already = Object.freeze({
      id: 'done',
      name: 'memory-recall',
      args: Object.freeze({ query: 'old' }),
      status: 'handed_off' as const,
    });
    const queue: QueuedLocalToolCall[] = [already];
    const queued = enqueueLocalTool(queue, { id: 'new', name: 'project-create', args: { name: 'Next' } });

    expect(handoff(queue)).toEqual([
      { id: 'new', name: 'project-create', args: { name: 'Next' }, status: 'handed_off' },
    ]);
    expect(queue).toEqual([already, queued]);
    expect(queue[0]).toBe(already);
    expect(handoff([])).toEqual([]);
  });

  it('refuses to turn a local tool call into a platform request', () => {
    const queue: QueuedLocalToolCall[] = [];
    const queued = enqueueLocalTool(queue, { id: 'call-1', name: 'ticket-create', args: { title: 'Local' } });

    expect(() => refusesPlatform(queued)).toThrow(PLATFORM_TOOL_REFUSED);
    try {
      refusesPlatform({ name: 'ticket-create', args: { title: 'Local' } });
      expect.unreachable('a local tool call must not become a platform request');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(PLATFORM_TOOL_REFUSED);
      expect((error as { code?: string }).code).toBe(PLATFORM_TOOL_REFUSED);
    }

    expect(queue).toEqual([queued]);
    expect(queued.status).toBe('queued');
  });

  it('does not import a network client', () => {
    const source = readFileSync(new URL('./localToolHandoff.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/import\s+[^;]*\bfetch\b/);
    expect(source).not.toMatch(/from\s+['"]node:(https?|http|net)['"]/);
    expect(source).not.toMatch(/\bMCP\b/);
  });
});
