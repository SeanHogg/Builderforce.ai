/**
 * The whole path of a run's file hashes (PRD 38 §4.10): the write/edit tools record what the
 * run left → a durable run carries them across ticks → files its children committed lose
 * them → the run-end facts anchor to what is left. Each hop is the real code; only the
 * workspace storage, the branch diff and the final fact write are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityProvider, RepoWriteCapability } from '@builderforce/agent-tools';

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  diff: vi.fn(),
  write: vi.fn(),
  knowledge: vi.fn(async () => ({ factsWritten: 1, relationsWritten: 0, staleMarked: 0 })),
}));

vi.mock('./ideWorkspaceCoding', () => ({
  listIdeWorkspaceFiles: vi.fn(), searchIdeWorkspace: vi.fn(), deleteIdeWorkspaceFile: vi.fn(),
  readIdeWorkspaceFile: vi.fn(async (_b: unknown, _p: unknown, path: string) =>
    h.files.has(path) ? { ok: true, path, content: h.files.get(path) } : { ok: false, error: 'not found' }),
  writeIdeWorkspaceFile: vi.fn(async (_db: unknown, _ide: unknown, a: { path: string; content: string }) => {
    h.files.set(a.path, a.content);
    return { ok: true, branch: 'workspace', change: 'created' };
  }),
  // The edit is applied in storage; the tool is NOT handed the resulting text.
  editIdeWorkspaceFile: vi.fn(async (_db: unknown, _ide: unknown, a: { path: string; oldString: string; newString: string }) => {
    h.files.set(a.path, (h.files.get(a.path) ?? '').replace(a.oldString, a.newString));
    return { ok: true, branch: 'workspace', change: 'modified', replaced: 1 };
  }),
}));
vi.mock('../executionEvents', () => ({ notifyExecutionSubscribers: vi.fn() }));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: vi.fn(async () => undefined) }));
vi.mock('../../coordination/coordinationCapability', () => ({ guardRepoWrite: (inner: RepoWriteCapability) => inner }));
vi.mock('../../repos/readRepoContents', () => ({ listBranchDiff: h.diff }));
vi.mock('../../knowledge/writeKnowledge', () => ({ writeKnowledge: h.knowledge }));

import { withIdeWorkspace } from './ideWorkspaceProvider';
import { absorbChildWrites } from '../cloudChildRuns';
import { commitRunMemory } from './runEndMemory';
import { sha256Hex } from '../../../domain/shared/hash';
import { seedWrittenHashes, snapshotWrittenHashes } from './writtenFileHashes';

const ide = { bucket: {} as R2Bucket, projectId: 12, projectName: 'Billing' };
const base = { capabilities: new Set(['repo.read', 'repo.write']) } as unknown as CapabilityProvider;

/** One tick of the run: a provider over the run's live sets, as the engine builds it. */
function tick(resume?: { writtenPaths: string[]; writtenHashes: Record<string, string> }) {
  const writtenPaths = new Set(resume?.writtenPaths ?? []);
  const writtenHashes = seedWrittenHashes(resume?.writtenHashes);
  const p = withIdeWorkspace(base, ide, { tenantId: 1, taskId: 5, executionId: 77, agentLabel: 'Agent', writtenPaths, writtenHashes }, { env: {} as never, db: {} as never });
  return { p, writtenPaths, writtenHashes };
}
const persist = (t: ReturnType<typeof tick>) =>
  JSON.parse(JSON.stringify({ writtenPaths: [...t.writtenPaths], writtenHashes: snapshotWrittenHashes(t.writtenHashes) })) as { writtenPaths: string[]; writtenHashes: Record<string, string> };

beforeEach(() => {
  h.files.clear();
  h.diff.mockReset();
  h.knowledge.mockClear();
});

describe('a run’s written-file hashes, tool to run-end fact', () => {
  it('anchors the run-end fact to what the run left, across ticks and past a child’s rewrite', async () => {
    // Tick 1: a write, then a write + an edit of another file.
    const t1 = tick();
    await t1.p.repoWrite!.writeFile('src/a.ts', 'one');
    await t1.p.repoWrite!.writeFile('src/b.ts', 'two');
    await t1.p.repoWrite!.editFile('src/b.ts', 'two', 'two!');
    expect(t1.writtenHashes.get('src/b.ts')).toBe(await sha256Hex('two!'));

    // The DO parks the run; tick 2 resumes from the persisted state and writes one more.
    const t2 = tick(persist(t1));
    expect(t2.writtenHashes.get('src/a.ts')).toBe(await sha256Hex('one'));
    await t2.p.repoWrite!.writeFile('src/c.ts', 'three');

    // A child rewrote src/b.ts and added src/d.ts on the shared branch; finish absorbs them.
    h.diff.mockResolvedValue({ ok: true, files: [{ path: 'src/b.ts' }, { path: 'src/d.ts' }], truncated: false });
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 78 }] }) }) }) } as never;
    await absorbChildWrites(db, 1, 77, { branch: 'bf/task-5', base: 'main' } as never, t2.writtenPaths, t2.writtenHashes);

    // Run end: the outcome fact is anchored with the hashes the run still stands behind.
    const ok = await commitRunMemory({
      db: {} as never, env: {} as never, tenantId: 1, projectId: 2, ticketId: null, executionId: 77,
      summary: 'Reworked the billing retry policy across several files for review.',
      writtenPaths: [...t2.writtenPaths],
      writtenFileHashes: snapshotWrittenHashes(t2.writtenHashes),
    });
    expect(ok).toBe(true);
    const [, input] = h.knowledge.mock.calls[0] as unknown as [unknown, { facts: Array<{ fileAnchors: Array<{ path: string; contentHash?: string }> }> }];
    const anchors = Object.fromEntries(input.facts[0]!.fileAnchors.map((a) => [a.path, a.contentHash]));
    expect(anchors).toEqual({
      'src/a.ts': await sha256Hex('one'),     // written on tick 1, carried across the resume
      'src/c.ts': await sha256Hex('three'),   // written on tick 2
      'src/b.ts': undefined,                  // a child rewrote it: unhashed, never falsely stale
      'src/d.ts': undefined,                  // a child's file: not the run's text
    });
  });
});
