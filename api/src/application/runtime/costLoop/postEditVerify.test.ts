import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ readRepoFile: vi.fn() }));
vi.mock('../../repos/readRepoContents', () => ({ readRepoFile: h.readRepoFile }));

import { verifyAfterEdit, withPostEditNote } from './postEditVerify';

const repoCtx = { branch: 'bf/task-1', base: 'main' } as never;

describe('verifyAfterEdit (D7)', () => {
  it('checks a write on the bytes it sent, without reading back', async () => {
    const v = await verifyAfterEdit({ name: 'write_file', args: { path: 'a.json', content: '{"x":' } }, { ok: true }, repoCtx);
    expect(v?.ok).toBe(false);
    expect(h.readRepoFile).not.toHaveBeenCalled();
  });

  it('checks an edit on the committed result', async () => {
    h.readRepoFile.mockResolvedValueOnce({ ok: true, path: 'b.yaml', content: 'a: [1, 2' });
    const v = await verifyAfterEdit({ name: 'edit_file', args: { path: 'b.yaml', old_string: 'x', new_string: 'y' } }, { ok: true }, repoCtx);
    expect(v?.ok).toBe(false);
    expect(h.readRepoFile).toHaveBeenCalledWith(expect.objectContaining({ ref: 'bf/task-1' }), 'b.yaml');
  });

  it('has nothing to say about a failed edit, a non-edit, an unbound repo or an unchecked file type', async () => {
    expect(await verifyAfterEdit({ name: 'write_file', args: { path: 'a.json', content: '{' } }, { ok: false }, repoCtx)).toBeNull();
    expect(await verifyAfterEdit({ name: 'read_file', args: { path: 'a.json' } }, { ok: true }, repoCtx)).toBeNull();
    expect(await verifyAfterEdit({ name: 'write_file', args: { path: 'a.json', content: '{' } }, { ok: true }, null)).toBeNull();
    expect(await verifyAfterEdit({ name: 'write_file', args: { path: 'README.md', content: '#' } }, { ok: true }, repoCtx)).toBeNull();
  });

  it('adds one note on a failure and nothing on a pass', async () => {
    const bad = await verifyAfterEdit({ name: 'write_file', args: { path: 'a.json', content: '{' } }, { ok: true }, repoCtx);
    expect((withPostEditNote({ ok: true }, bad) as { note: string }).note).toMatch(/^Post-edit check FAILED[\s\S]*a\.json/);
    const good = await verifyAfterEdit({ name: 'write_file', args: { path: 'a.json', content: '{}' } }, { ok: true }, repoCtx);
    expect(withPostEditNote({ ok: true }, good)).toEqual({ ok: true });
  });
});
