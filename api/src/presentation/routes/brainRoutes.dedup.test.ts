/**
 * A keyed POST that deduplicates - a retry of a message that already committed (a save that timed out and landed
 * late, then was sent again from the requeued words) - answers the ORIGINAL rows and fires NONE of the effects a first
 * attempt does: no `comment.added` on a linked ticket, no ping, no agent reply, no learning pass. Only messages
 * actually WRITTEN by the request do.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { BrainService } from '../../application/brain/BrainService';
import { errorHandler } from '../middleware/errorHandler';

const learn = vi.hoisted(() => vi.fn(async () => ({ learned: true, version: 3, reason: null })));
vi.mock('../../application/brain/brainEvermindLearning', async (importOriginal) => ({ ...(await importOriginal<object>()), learnFromPersistedTurns: learn }));

const { createBrainRoutes } = await import('./brainRoutes');

const ROW = { id: 5, role: 'user', content: 'keep going', metadata: null, seq: 5, createdAt: new Date(0) };

function mount(outcome: { messages: unknown[]; written: unknown[]; writtenRows: unknown[] }) {
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
    return chain;
  });
  const db = { select } as unknown as Db;
  const agentReply = vi.fn(async () => ({}));
  const service = { appendMessages: vi.fn(async () => outcome), agentReply } as unknown as BrainService;
  const waited: Array<Promise<unknown>> = [];
  const app = new Hono<HonoEnv>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('isEmulation', true);
    c.set('tenantId', 5);
    c.set('userId', 'user-1');
    c.set('role', TenantRole.MANAGER);
    Object.defineProperty(c, 'executionCtx', { value: { waitUntil: (p: Promise<unknown>) => { waited.push(p); } }, configurable: true });
    await next();
  });
  app.route('/', createBrainRoutes(service, db));
  return { app, select, agentReply, waited };
}

const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const SENT = { messages: [{ role: 'user', content: 'keep going', eventKey: 'steer:k', metadata: JSON.stringify({ addressedTo: { kind: 'agent', ref: 'ada', name: 'ada' } }) }] };

describe('POST /chats/:id/messages - a deduplicated keyed post fires no effects', () => {
  it('answers the original rows, and asks no ticket link, pings no one, dispatches no agent, runs no learning pass', async () => {
    learn.mockClear();
    const { app, select, agentReply, waited } = mount({ messages: [ROW], written: [], writtenRows: [] });

    const res = await app.request('/chats/9/messages', post(SENT));

    expect(res.status).toBe(201);
    expect(((await res.json()) as { messages: unknown[] }).messages).toHaveLength(1);
    await Promise.all(waited);
    expect(select).not.toHaveBeenCalled();
    expect(agentReply).not.toHaveBeenCalled();
    expect(learn).not.toHaveBeenCalled();
  });

  it('a message actually written does fire them (the first attempt)', async () => {
    learn.mockClear();
    const plain = { role: 'user', content: 'plain', eventKey: 'steer:k2' };
    const { app, select, waited } = mount({ messages: [ROW], written: [plain], writtenRows: [ROW] });

    const res = await app.request('/chats/9/messages', post({ messages: [plain] }));
    await Promise.all(waited);

    expect(res.status).toBe(201);
    expect(select).toHaveBeenCalled(); // the ticket links of the chat are asked for
    expect(learn).toHaveBeenCalledTimes(1);
  });
});
