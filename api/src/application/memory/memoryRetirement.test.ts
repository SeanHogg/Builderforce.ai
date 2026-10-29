/**
 * Removing project facts through governed memory keeps the knowledge graph honest (PRD 38
 * §8.3): `memory_forget` follows the author/admin rule and removes relations, the expiry purge
 * removes the relations of what it deleted, and both (and the decay sweep) bump the project's
 * knowledge version.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteFact: vi.fn(async () => true),
  store: { factAuthor: vi.fn(), deleteRelationsOf: vi.fn(async () => 2) },
  bumpProject: vi.fn(async () => undefined),
  retire: vi.fn(async () => undefined),
}));
vi.mock('../llm/projectFactsStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llm/projectFactsStore')>()),
  bumpProjectFactsVersion: mocks.bumpProject,
}));
vi.mock('../llm/projectFactsWrite', () => ({ upsertProjectFact: vi.fn(), deleteProjectFact: mocks.deleteFact }));
vi.mock('../knowledge/knowledgeWritePorts', () => ({ knowledgeWritePortsFor: () => ({ store: mocks.store, extracted: {} }) }));
vi.mock('../knowledge/knowledgeVersion', () => ({ bumpKnowledgeVersion: vi.fn(async () => undefined), knowledgeVersion: vi.fn() }));
vi.mock('../knowledge/retireFacts', () => ({ retireRelationsOfRemovedFacts: mocks.retire }));
vi.mock('../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: vi.fn(async () => false) }));

import { forget } from './memoryService';
import { purgeExpiredMemories } from './purgeExpiredMemories';
import { sweepUnrecalledFactDecay } from '../llm/projectFactsDecay';

const ctx = { tenantId: 1, projectId: 2, ticketId: null };
const db = {
  delete: () => ({ where: () => ({ returning: async () => [] }) }),
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteFact.mockResolvedValue(true);
});

describe('memory_forget on a project fact', () => {
  it('refuses to delete a fact authored by a person, touching nothing', async () => {
    mocks.store.factAuthor.mockResolvedValue('u7');
    const out = await forget({} as never, db, ctx, 'claim:x');
    expect(out.ok).toBe(false);
    expect(mocks.store.deleteRelationsOf).not.toHaveBeenCalled();
    expect(mocks.deleteFact).not.toHaveBeenCalled();
  });

  it('deletes an authorless (agent / pre-1278) fact together with its relations', async () => {
    mocks.store.factAuthor.mockResolvedValue(null);
    const out = await forget({} as never, db, ctx, 'claim:x');
    expect(out).toEqual({ ok: true, key: 'claim:x', deleted: true });
    expect(mocks.store.deleteRelationsOf).toHaveBeenCalledWith('fact:claim:x');
  });

  it('lets a human admin forget a person’s fact', async () => {
    mocks.store.factAuthor.mockResolvedValue('u7');
    const out = await forget({} as never, db, ctx, 'claim:x', { userId: 'u1', role: 'manager' });
    expect(out).toMatchObject({ ok: true, deleted: true });
  });
});

describe('purgeExpiredMemories', () => {
  it('hands the deleted project facts to the relation cleanup', async () => {
    const rows = [{ id: 'a', tenantId: 1, projectId: 2, key: 'k1' }];
    const purgeDb = { delete: () => ({ where: () => ({ returning: () => ({ catch: async () => rows }) }) }) } as never;
    await purgeExpiredMemories({} as never, purgeDb, 1);
    expect(mocks.retire).toHaveBeenCalledTimes(1);
    expect((mocks.retire.mock.calls[0] as unknown[])[2]).toEqual(rows);
  });
});

describe('sweepUnrecalledFactDecay', () => {
  it('bumps the project’s fact version when it expires facts', async () => {
    const decayDb = { update: () => ({ set: () => ({ where: () => ({ returning: () => ({ catch: async () => [{ key: 'k' }] }) }) }) }) } as never;
    const n = await sweepUnrecalledFactDecay({} as never, decayDb, 1, 2);
    expect(n).toBe(1);
    expect(mocks.bumpProject).toHaveBeenCalledWith(expect.anything(), 1, 2);
  });

  it('does not bump when nothing expired', async () => {
    const decayDb = { update: () => ({ set: () => ({ where: () => ({ returning: () => ({ catch: async () => [] }) }) }) }) } as never;
    await sweepUnrecalledFactDecay({} as never, decayDb, 1, 2);
    expect(mocks.bumpProject).not.toHaveBeenCalled();
  });
});
