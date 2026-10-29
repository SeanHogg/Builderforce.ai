/**
 * Non-person writers reach project memory through the ONE writer as a machine caller:
 * the origin is stamped `agent` server-side, with no author.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upsert: vi.fn(async () => true), bump: vi.fn(async () => undefined) }));
vi.mock('../llm/projectFactsWrite', () => ({ upsertProjectFact: mocks.upsert, deleteProjectFact: vi.fn() }));
vi.mock('./knowledgeVersion', () => ({ bumpKnowledgeVersion: mocks.bump, knowledgeVersion: vi.fn() }));

import { writeProjectFact } from './writeProjectFact';

beforeEach(() => vi.clearAllMocks());

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
});
