import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComposerAttachments } from './useComposerAttachments';

/** A persistence whose upload resolves (or rejects) only when the test says so. */
function controlledPersistence() {
  type Saved = { key: string; name: string; type: string };
  let settle: { resolve: (v: Saved) => void; reject: (e: unknown) => void } | null = null;
  const upload = vi.fn(() => new Promise<Saved>((resolve, reject) => { settle = { resolve, reject }; }));
  // The upload starts after the picture check (`prepareAttachment`): wait for it, then settle it.
  const started = () => vi.waitFor(() => { if (!settle) throw new Error('upload not started'); });
  return {
    persistence: { upload },
    resolve: async (v: Saved) => { await started(); settle!.resolve(v); },
    reject: async (e: unknown) => { await started(); settle!.reject(e); },
  };
}

const pdf = () => new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' });

describe('useComposerAttachments — a chip before the upload', () => {
  const created: string[] = [];
  const revoked: string[] = [];
  beforeEach(() => {
    created.length = 0;
    revoked.length = 0;
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const u = `blob:local-${++n}`; created.push(u); return u; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => { revoked.push(u); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('regression: the chip shows at once (uploading, local original), then becomes the uploaded attachment', async () => {
    const c = controlledPersistence();
    const { result } = renderHook(() => useComposerAttachments(c.persistence, undefined));
    let done!: Promise<void>;
    act(() => { done = result.current.attach(pdf()); });

    expect(result.current.chips).toEqual([
      { key: expect.stringMatching(/^staged-/), name: 'spec.pdf', type: 'application/pdf', size: 4, localUrl: 'blob:local-1', status: 'uploading' },
    ]);
    expect(result.current.uploading).toBe(true);
    // Nothing a send could take yet.
    expect(result.current.pending).toEqual([]);

    await act(async () => { await c.resolve({ key: 'up-1', name: 'spec.pdf', type: 'application/pdf' }); await done; });
    expect(result.current.uploading).toBe(false);
    expect(result.current.pending).toEqual([{ key: 'up-1', name: 'spec.pdf', type: 'application/pdf' }]);
    expect(result.current.chips).toEqual([{ key: 'up-1', name: 'spec.pdf', type: 'application/pdf', size: 4, localUrl: 'blob:local-1' }]);
  });

  it('a refused upload turns the chip into an error with the host\'s sentence, removable, never pending', async () => {
    const c = controlledPersistence();
    const { result } = renderHook(() => useComposerAttachments(c.persistence, undefined));
    let done!: Promise<void>;
    act(() => { done = result.current.attach(pdf()); });
    await act(async () => { await c.reject(new Error('Local only is on, so spec.pdf stays on this machine.')); await done; });

    const [chip] = result.current.chips;
    expect(chip).toMatchObject({ name: 'spec.pdf', status: 'error', error: 'Local only is on, so spec.pdf stays on this machine.' });
    expect(result.current.pending).toEqual([]);
    expect(result.current.uploading).toBe(false);

    act(() => result.current.remove(chip!.key));
    expect(result.current.chips).toEqual([]);
    expect(revoked).toEqual(['blob:local-1']);
  });

  it('a chip removed while uploading is dropped when its upload lands, and its object URL is revoked', async () => {
    const c = controlledPersistence();
    const { result } = renderHook(() => useComposerAttachments(c.persistence, undefined));
    let done!: Promise<void>;
    act(() => { done = result.current.attach(pdf()); });
    act(() => result.current.remove(result.current.chips[0]!.key));
    await act(async () => { await c.resolve({ key: 'up-1', name: 'spec.pdf', type: 'application/pdf' }); await done; });
    expect(result.current.chips).toEqual([]);
    expect(result.current.pending).toEqual([]);
    expect(revoked).toEqual(['blob:local-1']);
  });

  it('revokes the local originals when a send takes the files, and on unmount', async () => {
    const c = controlledPersistence();
    const { result, unmount } = renderHook(() => useComposerAttachments(c.persistence, undefined));
    let done!: Promise<void>;
    act(() => { done = result.current.attach(pdf()); });
    await act(async () => { await c.resolve({ key: 'up-1', name: 'spec.pdf', type: 'application/pdf' }); await done; });
    act(() => { done = result.current.attach(pdf()); });
    act(() => result.current.take([{ key: 'up-1' }]));
    expect(revoked).toEqual(['blob:local-1']);
    unmount();
    expect(revoked).toEqual(['blob:local-1', 'blob:local-2']);
  });
});
