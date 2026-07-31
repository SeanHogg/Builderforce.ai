import { describe, expect, it, vi } from 'vitest';
import type { Capability, CapabilityProvider } from '@builderforce/agent-tools';
import { ShadowRecorder, shadowProvider } from './shadowProvider';

/** A provider that records whether each REAL effect was reached. */
function liveProvider(caps: Capability[] = ['repo.read', 'repo.write', 'memory', 'human', 'coordinate']) {
  const spies = {
    writeFile: vi.fn(async () => ({ ok: true, branch: 'b', change: 'created' as const })),
    editFile: vi.fn(async () => ({ ok: true, replaced: 1 })),
    deleteFile: vi.fn(async () => ({ ok: true, deleted: true })),
    remember: vi.fn(async () => ({ ok: true, key: 'k' })),
    forget: vi.fn(async () => ({ ok: true, key: 'k', deleted: true })),
    recall: vi.fn(async () => ({ ok: true, query: 'q', entries: [{ key: 'k', content: 'real memory' }] })),
    ask: vi.fn(async () => ({ paused: true, approvalId: 'a1' })),
    claim: vi.fn(async () => ({ ok: true, granted: true })),
    release: vi.fn(async () => ({ ok: true, released: true })),
    postNote: vi.fn(async () => ({ ok: true, key: 'n' })),
    listClaims: vi.fn(async () => ({ ok: true, leases: [] })),
    readNotes: vi.fn(async () => ({ ok: true, notes: [] })),
    readFile: vi.fn(async () => ({ ok: true, path: 'a.ts', content: 'real file' })),
    listFiles: vi.fn(async () => ({ ok: true, paths: ['a.ts'] })),
    searchCode: vi.fn(async () => ({ ok: true, matches: [] })),
    run: vi.fn(async () => ({ ok: true, stdout: '' })),
  };
  const provider: CapabilityProvider = {
    capabilities: new Set<Capability>(caps),
    repoRead: { listFiles: spies.listFiles, readFile: spies.readFile, searchCode: spies.searchCode },
    repoWrite: { writeFile: spies.writeFile, editFile: spies.editFile, deleteFile: spies.deleteFile },
    memory: { remember: spies.remember, recall: spies.recall, forget: spies.forget },
    human: { ask: spies.ask },
    coordination: {
      claim: spies.claim, release: spies.release, postNote: spies.postNote,
      listClaims: spies.listClaims, readNotes: spies.readNotes,
    },
    shell: { run: spies.run },
  };
  return { provider, spies };
}

describe('shadowProvider — nothing escapes', () => {
  it('records a write instead of committing it, and still reports success', async () => {
    const { provider, spies } = liveProvider();
    const rec = new ShadowRecorder();
    const r = await shadowProvider(provider, rec).repoWrite!.writeFile('src/a.ts', 'contents', 'why');
    // Success is deliberate: a failure would make the agent retry or abandon its plan,
    // and the rehearsal would measure "how it behaves when git is broken".
    expect(r.ok).toBe(true);
    expect(spies.writeFile).not.toHaveBeenCalled();
    expect(rec.steps).toEqual([
      { op: 'repo.write', target: 'src/a.ts', detail: { content: 'contents', summary: 'why' } },
    ]);
  });

  it('records edits and deletes too, and counts them as writes', async () => {
    const { provider, spies } = liveProvider();
    const rec = new ShadowRecorder();
    const w = shadowProvider(provider, rec).repoWrite!;
    await w.editFile('a.ts', 'x', 'y', true);
    await w.deleteFile('b.ts', 'obsolete');
    expect(spies.editFile).not.toHaveBeenCalled();
    expect(spies.deleteFile).not.toHaveBeenCalled();
    expect(rec.writeCount).toBe(2);
  });

  it('suppresses memory writes but PASSES RECALL THROUGH', async () => {
    const { provider, spies } = liveProvider();
    const rec = new ShadowRecorder();
    const mem = shadowProvider(provider, rec).memory!;
    await mem.remember('k', 'v', { scope: 'project', ttlDays: 7 });
    await mem.forget!('k');
    const recalled = await mem.recall('q');
    expect(spies.remember).not.toHaveBeenCalled();
    expect(spies.forget).not.toHaveBeenCalled();
    // Recall must be REAL — an agent reasoning over empty memory is a different agent.
    expect(spies.recall).toHaveBeenCalledOnce();
    expect(recalled.entries?.[0]?.content).toBe('real memory');
    expect(rec.steps.map((s) => s.op)).toEqual(['memory.remember', 'memory.forget']);
  });

  it('answers ask_human synthetically instead of pausing forever', async () => {
    const { provider, spies } = liveProvider();
    const rec = new ShadowRecorder();
    const r = await shadowProvider(provider, rec).human!.ask('Which database?', 'ctx');
    expect(spies.ask).not.toHaveBeenCalled();
    expect(r.paused).toBe(false);
    expect(r.answer).toBeTruthy();
    expect(rec.steps[0]?.op).toBe('human.ask');
  });

  it('never takes a real lease (a rehearsal must not block a live agent) but reads them', async () => {
    const { provider, spies } = liveProvider();
    const rec = new ShadowRecorder();
    const co = shadowProvider(provider, rec).coordination!;
    await co.claim('src/a.ts');
    await co.postNote('k', 'mine');
    await co.listClaims();
    await co.readNotes();
    expect(spies.claim).not.toHaveBeenCalled();
    expect(spies.postNote).not.toHaveBeenCalled();
    expect(spies.listClaims).toHaveBeenCalledOnce();
    expect(spies.readNotes).toHaveBeenCalledOnce();
  });

  it('passes every READ through untouched', async () => {
    const { provider, spies } = liveProvider();
    const shadowed = shadowProvider(provider, new ShadowRecorder());
    expect((await shadowed.repoRead!.readFile('a.ts')).content).toBe('real file');
    expect(spies.readFile).toHaveBeenCalledOnce();
    await shadowed.repoRead!.listFiles();
    await shadowed.repoRead!.searchCode('q');
    expect(spies.listFiles).toHaveBeenCalledOnce();
    expect(spies.searchCode).toHaveBeenCalledOnce();
  });

  it('DROPS shell — an unshadowable capability cannot be advertised', async () => {
    const { provider } = liveProvider(['repo.read', 'shell', 'process', 'memory']);
    const shadowed = shadowProvider(provider, new ShadowRecorder());
    // There is no way to tell `ls` from `rm -rf` before running it, so the guarantee
    // is kept by removing the capability rather than by trying to classify commands.
    expect(shadowed.shell).toBeUndefined();
    expect(shadowed.capabilities.has('shell')).toBe(false);
    expect(shadowed.capabilities.has('process')).toBe(false);
    expect(shadowed.capabilities.has('memory')).toBe(true);
  });

  it('keeps the rest of the capability set intact so the model is offered the real tools', () => {
    const { provider } = liveProvider();
    const shadowed = shadowProvider(provider, new ShadowRecorder());
    // Withdrawing repo.write here would rehearse a read-only agent.
    expect(shadowed.capabilities.has('repo.write')).toBe(true);
    expect(shadowed.capabilities.has('human')).toBe(true);
    expect(shadowed.capabilities.has('coordinate')).toBe(true);
  });

  it('truncates a huge write so one rehearsal cannot blow up the step row', async () => {
    const { provider } = liveProvider();
    const rec = new ShadowRecorder();
    await shadowProvider(provider, rec).repoWrite!.writeFile('big.ts', 'x'.repeat(50_000));
    const recorded = rec.steps[0]?.detail.content as string;
    expect(recorded.length).toBeLessThan(50_000);
    expect(recorded).toContain('truncated');
  });

  it('counts only repo effects as writes, not memory or escalations', async () => {
    const { provider } = liveProvider();
    const rec = new ShadowRecorder();
    const s = shadowProvider(provider, rec);
    await s.repoWrite!.writeFile('a.ts', 'x');
    await s.memory!.remember('k', 'v');
    await s.human!.ask('q');
    expect(rec.steps).toHaveLength(3);
    expect(rec.writeCount).toBe(1);
  });
});
