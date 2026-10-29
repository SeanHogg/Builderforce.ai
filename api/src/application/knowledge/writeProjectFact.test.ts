/**
 * Non-person writers reach project memory through the ONE writer as a machine caller:
 * the origin is stamped `agent` server-side, with no author.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(async () => true),
  bump: vi.fn(async () => undefined),
  // The author of the existing fact: undefined = none, null = no recorded author, string = a person.
  factAuthor: vi.fn(async (_key: string): Promise<string | null | undefined> => undefined),
}));
vi.mock('../llm/projectFactsWrite', () => ({ upsertProjectFact: mocks.upsert, deleteProjectFact: vi.fn() }));
vi.mock('./knowledgeWritePorts', () => ({
  knowledgeWritePortsFor: () => ({ store: { factAuthor: mocks.factAuthor, upsertRelations: vi.fn(async () => 0) }, extracted: {} }),
}));
vi.mock('./knowledgeVersion', () => ({ bumpKnowledgeVersion: mocks.bump, knowledgeVersion: vi.fn() }));

import { writeProjectFact } from './writeProjectFact';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.factAuthor.mockResolvedValue(undefined);
});

describe('writeProjectFact', () => {
  it('writes an agent fact with its anchors and expiry, no author, one version bump', async () => {
    const expiresAt = new Date('2030-01-01');
    const ok = await writeProjectFact(
      { env: {} as never, db: {} as never, tenantId: 1, projectId: 2 },
      { key: 'k', content: 'c', source: 'cloud-run', expiresAt, originExecutionId: 7, fileAnchors: [{ path: 'a.ts', contentHash: 'h' }] },
    );
    expect(ok).toBe(true);
    const call = mocks.upsert.mock.calls[0] as unknown as unknown[];
    expect(call.slice(2, 7)).toEqual([1, 2, 'k', 'c', 'cloud-run']);
    expect(call[7]).toMatchObject({
      factOrigin: 'agent', createdBy: null, expiresAt, originExecutionId: 7,
      fileAnchors: [{ path: 'a.ts', contentHash: 'h' }], retireByAnchor: false, deferVersionBump: true,
    });
    expect(mocks.bump).toHaveBeenCalledTimes(1);
  });

  it('reports false when the fact upsert refuses the write', async () => {
    mocks.upsert.mockResolvedValueOnce(false);
    expect(await writeProjectFact({ env: {} as never, db: {} as never, tenantId: 1, projectId: 0 }, { key: 'k', content: 'c', source: 's' })).toBe(false);
  });

  it('does not overwrite a fact a person authored: reports false and writes nothing', async () => {
    mocks.factAuthor.mockResolvedValue('u7');
    const ok = await writeProjectFact({ env: {} as never, db: {} as never, tenantId: 1, projectId: 2 }, { key: 'decision:retries', content: 'agent view', source: 'cloud-run' });
    expect(ok).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('merges a code map into a person’s fact without taking its origin', async () => {
    mocks.factAuthor.mockResolvedValue('u7');
    const ok = await writeProjectFact({ env: {} as never, db: {} as never, tenantId: 1, projectId: 2 }, { key: 'codemap:src/billing', content: '- src/billing/a.ts: x', source: 'cloud-run' });
    expect(ok).toBe(true);
    const opts = (mocks.upsert.mock.calls[0] as unknown as unknown[])[7] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('factOrigin');
    expect(opts).toMatchObject({ createdBy: null });
  });
});
