/**
 * A scriptable in-memory `LocalModelStore` for the local-model tests — the same contract
 * brain-embedded's store keeps (state per row, progress, subscribe, abortable download),
 * with each transition driven by the test instead of a network.
 */
import type { LocalModelRow, LocalModelStore } from '@seanhogg/builderforce-brain-embedded';

export function catalogRow(overrides: Partial<LocalModelRow> & Pick<LocalModelRow, 'ref' | 'label'>): LocalModelRow {
  return {
    runtime: 'bfi',
    model: overrides.ref.split('/').pop() ?? overrides.ref,
    family: 'bonsai',
    params: 8_190_000_000,
    bytes: 1_158_654_496,
    contextTokens: 65_536,
    tools: true,
    uses: ['chat'],
    recommended: true,
    source: { kind: 'hf-file', repo: 'prism-ml/Bonsai-8B-gguf', file: 'Bonsai-8B-Q1_0.gguf' },
    requires: { minBufferBytes: 128 * 1024 * 1024 },
    state: 'absent',
    ...overrides,
  };
}

export interface FakeStore {
  store: LocalModelStore;
  progress(ref: string, fraction: number): void;
  finish(ref: string): void;
  fail(ref: string): void;
  /** How many times the picker listed the store. */
  lists(): number;
}

export function fakeLocalModelStore(initial: LocalModelRow[]): FakeStore {
  let rows = initial.map((row) => ({ ...row }));
  let listCount = 0;
  const listeners = new Set<() => void>();
  const pending = new Map<string, { resolve: () => void; reject: (e: unknown) => void; signal?: AbortSignal }>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const patch = (ref: string, next: Partial<LocalModelRow>) => {
    rows = rows.map((row) => {
      if (row.ref !== ref) return row;
      const merged: LocalModelRow = { ...row, ...next };
      if (merged.state !== 'downloading') delete merged.progress;
      return merged;
    });
    emit();
  };

  const store: LocalModelStore = {
    async listLocalModels() {
      listCount += 1;
      return rows.map((row) => ({ ...row }));
    },
    download(ref, _onProgress, signal) {
      return new Promise<void>((resolve, reject) => {
        pending.set(ref, { resolve, reject, ...(signal ? { signal } : {}) });
        signal?.addEventListener('abort', () => {
          pending.delete(ref);
          patch(ref, { state: 'absent' });
          reject(new DOMException('Aborted', 'AbortError'));
        });
        patch(ref, { state: 'downloading', progress: 0 });
      });
    },
    async remove(ref) {
      patch(ref, { state: 'absent' });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    store,
    progress: (ref, fraction) => patch(ref, { state: 'downloading', progress: fraction }),
    finish(ref) {
      const p = pending.get(ref);
      pending.delete(ref);
      patch(ref, { state: 'ready' });
      p?.resolve();
    },
    fail(ref) {
      const p = pending.get(ref);
      pending.delete(ref);
      patch(ref, { state: 'absent' });
      p?.reject(new Error('network'));
    },
    lists: () => listCount,
  };
}
