/**
 * What the expiry purge owes the graph (PRD 38 §8.3): the relations of the facts it removed go
 * with them, grouped per project, with ONE knowledge-version bump per project — and one
 * failing project never leaves a later project with dangling edges.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteRelationsOf: vi.fn(async (_refs: unknown) => 0),
  bump: vi.fn(async (_env: unknown, _tenantId: number, _projectId: number) => undefined),
  report: vi.fn(),
  portsFor: vi.fn(),
}));
vi.mock('./knowledgeWritePorts', () => ({ knowledgeWritePortsFor: mocks.portsFor }));
vi.mock('./knowledgeVersion', () => ({ bumpKnowledgeVersion: mocks.bump, knowledgeVersion: vi.fn() }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: mocks.report }));

import { retireRelationsOfRemovedFacts } from './retireFacts';

const env = {} as never;
const db = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.portsFor.mockImplementation((_e: unknown, _d: unknown, tenantId: number, projectId: number) => ({
    store: { deleteRelationsOf: (refs: unknown) => mocks.deleteRelationsOf(refs) },
    scope: { tenantId, projectId },
  }));
});

describe('retireRelationsOfRemovedFacts', () => {
  it('removes the relations of each project’s facts in one call, and bumps each project once', async () => {
    await retireRelationsOfRemovedFacts(env, db, [
      { tenantId: 1, projectId: 10, key: 'a' },
      { tenantId: 1, projectId: 11, key: 'c' },
      { tenantId: 1, projectId: 10, key: 'b' },
      { tenantId: 2, projectId: 10, key: 'd' },
    ]);
    // Three projects (tenant 2's project 10 is not tenant 1's), one delete call and one bump each.
    expect(mocks.deleteRelationsOf).toHaveBeenCalledTimes(3);
    expect(mocks.deleteRelationsOf).toHaveBeenCalledWith(['fact:a', 'fact:b']);
    expect(mocks.deleteRelationsOf).toHaveBeenCalledWith(['fact:c']);
    expect(mocks.deleteRelationsOf).toHaveBeenCalledWith(['fact:d']);
    expect(mocks.portsFor.mock.calls.map((c) => [c[2], c[3]])).toEqual([[1, 10], [1, 11], [2, 10]]);
    expect(mocks.bump.mock.calls.map((c) => [c[1], c[2]])).toEqual([[1, 10], [1, 11], [2, 10]]);
  });

  it('does nothing for nothing removed', async () => {
    await retireRelationsOfRemovedFacts(env, db, []);
    expect(mocks.portsFor).not.toHaveBeenCalled();
    expect(mocks.bump).not.toHaveBeenCalled();
  });

  it('isolates a failing project: it is reported, still bumped, and the later projects are retired', async () => {
    mocks.deleteRelationsOf.mockImplementation(async (refs: unknown) => {
      if ((refs as string[]).includes('fact:boom')) throw new Error('db down');
      return 1;
    });
    await expect(retireRelationsOfRemovedFacts(env, db, [
      { tenantId: 1, projectId: 10, key: 'ok1' },
      { tenantId: 1, projectId: 11, key: 'boom' },
      { tenantId: 1, projectId: 12, key: 'ok2' },
    ])).resolves.toBeUndefined();
    expect(mocks.deleteRelationsOf).toHaveBeenCalledTimes(3);
    expect(mocks.report).toHaveBeenCalledTimes(1);
    expect(mocks.report.mock.calls[0]![1]).toMatchObject({ operation: 'delete-relations', context: { tenantId: 1, projectId: 11 } });
    // The failed project may have had its facts removed already: its cached graph must still be invalidated.
    expect(mocks.bump.mock.calls.map((c) => [c[1], c[2]])).toEqual([[1, 10], [1, 11], [1, 12]]);
  });

  it('reports a failing bump without failing the sweep or skipping the next project', async () => {
    mocks.bump.mockRejectedValueOnce(new Error('kv limit'));
    await retireRelationsOfRemovedFacts(env, db, [
      { tenantId: 1, projectId: 10, key: 'a' },
      { tenantId: 1, projectId: 11, key: 'b' },
    ]);
    expect(mocks.report.mock.calls[0]![1]).toMatchObject({ operation: 'bump-version' });
    expect(mocks.deleteRelationsOf).toHaveBeenCalledTimes(2);
    expect(mocks.bump).toHaveBeenCalledTimes(2);
  });
});
