import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaseClaimResult, RepoWriteCapability } from '@builderforce/agent-tools';

// The guard's whole job is to consult the lease store, so the store is the seam we
// control here — everything else in these tests is the real decorator.
const acquireLease = vi.fn<(...a: unknown[]) => Promise<LeaseClaimResult>>();
vi.mock('./leaseService', () => ({
  acquireLease: (...a: unknown[]) => acquireLease(...a),
  releaseLease: vi.fn(),
  listLeases: vi.fn(),
}));

const { guardRepoWrite } = await import('./coordinationCapability');

const holder = { tenantId: 1, executionId: 10, label: 'Ada', taskId: 5, repoSlug: 'acme/web', scopeKey: 'ticket:5' };
const env = {} as never;
const db = {} as never;

function innerWriter() {
  return {
    writeFile: vi.fn(async () => ({ ok: true, branch: 'b', change: 'created' as const })),
    editFile: vi.fn(async () => ({ ok: true, branch: 'b', replaced: 1 })),
    deleteFile: vi.fn(async () => ({ ok: true, deleted: true })),
  } satisfies RepoWriteCapability;
}

describe('guardRepoWrite', () => {
  beforeEach(() => acquireLease.mockReset());

  it('performs the write when the lease is granted', async () => {
    acquireLease.mockResolvedValue({ ok: true, granted: true });
    const inner = innerWriter();
    const r = await guardRepoWrite(inner, { env, db, holder }).writeFile('src/a.ts', 'x');
    expect(r.ok).toBe(true);
    expect(inner.writeFile).toHaveBeenCalledOnce();
  });

  it('REFUSES the write when a peer holds the path, and never touches the repo', async () => {
    acquireLease.mockResolvedValue({ ok: true, granted: false, heldBy: 'Grace', note: "'src/a.ts' is held by Grace." });
    const inner = innerWriter();
    const r = await guardRepoWrite(inner, { env, db, holder }).writeFile('src/a.ts', 'x');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Grace');
    // The actual regression this prevents: a second agent silently reverting the first
    // agent's change by committing over it on the shared ticket branch.
    expect(inner.writeFile).not.toHaveBeenCalled();
  });

  it('FAILS OPEN when the lease store itself errors — losing locking must not stop work', async () => {
    acquireLease.mockResolvedValue({ ok: false, error: 'db down' });
    const inner = innerWriter();
    const r = await guardRepoWrite(inner, { env, db, holder }).writeFile('src/a.ts', 'x');
    expect(r.ok).toBe(true);
    expect(inner.writeFile).toHaveBeenCalledOnce();
  });

  it('guards edit and delete on the same rule', async () => {
    acquireLease.mockResolvedValue({ ok: true, granted: false, heldBy: 'Grace' });
    const inner = innerWriter();
    const guarded = guardRepoWrite(inner, { env, db, holder });
    expect((await guarded.editFile('src/a.ts', 'a', 'b')).ok).toBe(false);
    expect((await guarded.deleteFile('src/a.ts')).ok).toBe(false);
    expect(inner.editFile).not.toHaveBeenCalled();
    expect(inner.deleteFile).not.toHaveBeenCalled();
  });

  it('claims EXCLUSIVE on every write path', async () => {
    acquireLease.mockResolvedValue({ ok: true, granted: true });
    await guardRepoWrite(innerWriter(), { env, db, holder }).writeFile('src/a.ts', 'x', 'add the thing');
    expect(acquireLease).toHaveBeenCalledWith(env, db, holder, 'src/a.ts', expect.objectContaining({ mode: 'exclusive' }));
  });

  it('reports a refusal to the caller so it lands on the run timeline', async () => {
    acquireLease.mockResolvedValue({ ok: true, granted: false, heldBy: 'Grace' });
    const onRefused = vi.fn();
    await guardRepoWrite(innerWriter(), { env, db, holder, onRefused }).writeFile('src/a.ts', 'x');
    expect(onRefused).toHaveBeenCalledWith('src/a.ts', 'Grace');
  });

  it('does not call onRefused when the store merely errored (that is not a conflict)', async () => {
    acquireLease.mockResolvedValue({ ok: false, error: 'db down' });
    const onRefused = vi.fn();
    await guardRepoWrite(innerWriter(), { env, db, holder, onRefused }).writeFile('src/a.ts', 'x');
    expect(onRefused).not.toHaveBeenCalled();
  });
});
