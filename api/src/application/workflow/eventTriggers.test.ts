import { describe, it, expect, vi } from 'vitest';
import { fireEventTriggers, hasEventTriggerListeners } from './eventTriggers';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

vi.mock('./instantiateRun', () => ({
  instantiateWorkflowRun: vi.fn(async () => ({ ok: true, workflowId: 'wf_1' })),
}));

/**
 * Minimal drizzle stand-in. `rows` is what the trigger lookup returns; every other
 * chained call resolves to whatever is queued next. The point of these tests is the
 * MATCHING and the listener gate, not drizzle.
 */
function fakeDb(rows: Array<Record<string, unknown>>, defs: Array<Record<string, unknown>> = [{ name: 'W', projectId: null, definition: '{"nodes":[],"edges":[]}' }]) {
  const selects = [rows, defs];
  let call = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: (..._a: unknown[]) => {
          const result = selects[Math.min(call++, selects.length - 1)] ?? [];
          return Object.assign(Promise.resolve(result), { limit: () => Promise.resolve(result) });
        },
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  return db as unknown as Db;
}

const triggerRow = (config: Record<string, unknown>) => ({
  id: 1, tenantId: 7, segmentId: null, definitionId: 'def_1', nodeId: 'n1',
  triggerType: 'board-event', enabled: true, config: JSON.stringify(config),
  runtime: 'cloud', agentHostId: null, cloudAgentRef: 'agent_1',
});

describe('fireEventTriggers filter matching', () => {
  it('fires an unfiltered trigger on any event', async () => {
    const result = await fireEventTriggers(fakeDb([triggerRow({})]), {
      tenantId: 7, eventType: 'board-event', payload: {}, match: { boardEvent: 'task-moved' },
    });
    expect(result).toMatchObject({ matched: 1, fired: 1, errors: 0 });
  });

  it('honours a filter on a NEW key — the board event a workflow subscribed to', async () => {
    const db = fakeDb([triggerRow({ boardEvent: 'task-completed' })]);
    expect(await fireEventTriggers(db, {
      tenantId: 7, eventType: 'board-event', payload: {}, match: { boardEvent: 'task-moved' },
    })).toMatchObject({ matched: 0, fired: 0 });

    expect(await fireEventTriggers(fakeDb([triggerRow({ boardEvent: 'task-completed' })]), {
      tenantId: 7, eventType: 'board-event', payload: {}, match: { boardEvent: 'task-completed' },
    })).toMatchObject({ matched: 1, fired: 1 });
  });

  it('matches any ALIAS the emitter offers — a form addressed by slug or by id', async () => {
    for (const filter of ['welcome-survey', 'qs_42']) {
      const result = await fireEventTriggers(fakeDb([triggerRow({ formId: filter })]), {
        tenantId: 7, eventType: 'form-submit', payload: {},
        match: { formId: ['welcome-survey', 'qs_42'] },
      });
      expect(result.fired, `filter ${filter}`).toBe(1);
    }
  });

  it('still applies the reliability filters it always did', async () => {
    expect(await fireEventTriggers(fakeDb([triggerRow({ severity: 'sev1' })]), {
      tenantId: 7, eventType: 'incident-created', payload: {}, match: { severity: 'sev3' },
    })).toMatchObject({ matched: 0 });
  });

  it('ignores a `source` label — it is a note on the node, never a filter', async () => {
    // Every trigger node carries a free-text "Source / label" field. Treating it as a
    // filter would silently stop every trigger whose author typed something into it.
    const result = await fireEventTriggers(fakeDb([triggerRow({ source: 'pricing page' })]), {
      tenantId: 7, eventType: 'board-event', payload: {}, match: { boardEvent: 'task-created' },
    });
    expect(result.fired).toBe(1);
  });
});

describe('the cached listener gate', () => {
  const env = {} as Env;

  it('answers false and skips the lookup when nothing subscribes', async () => {
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }));
    const db = { select } as unknown as Db;
    expect(await hasEventTriggerListeners(env, db, 7, 'page-view')).toBe(false);

    // A hot-path emitter therefore does no work beyond the gate. Different tenant so
    // this is an independent gate check rather than a hit on the line above's cache.
    const fireSelect = vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }));
    const result = await fireEventTriggers({ select: fireSelect } as unknown as Db, {
      tenantId: 8, env, eventType: 'page-view', payload: {},
    });
    expect(result).toMatchObject({ matched: 0, fired: 0, errors: 0 });
    // Exactly one query: the gate. The full row lookup never ran.
    expect(fireSelect).toHaveBeenCalledTimes(1);
  });

  it('caches the answer so a second event costs no query', async () => {
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 1 }]) }) }) }));
    const db = { select } as unknown as Db;
    expect(await hasEventTriggerListeners(env, db, 9, 'email-open')).toBe(true);
    expect(await hasEventTriggerListeners(env, db, 9, 'email-open')).toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without env — the caller then does the real lookup, as before', async () => {
    const select = vi.fn();
    expect(await hasEventTriggerListeners(undefined, { select } as unknown as Db, 9, 'signup')).toBe(true);
    expect(select).not.toHaveBeenCalled();
  });
});
