import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  localStorageConfirmationPersistence,
  useToolConfirmationGate,
  type ToolConfirmationPersistence,
} from './useToolConfirmationGate';

const isMutating = (name: string) => name.startsWith('create') || name.startsWith('delete');

/** An in-memory persistence double, so a test never depends on the real store. */
function memoryPersistence(initial?: boolean): ToolConfirmationPersistence & { value?: boolean } {
  const store: { value?: boolean } = { value: initial };
  return Object.assign(store, {
    read: () => store.value,
    write: (on: boolean) => {
      store.value = on;
    },
  });
}

describe('useToolConfirmationGate', () => {
  it('confirms a mutating call and lets a read-only one straight through', () => {
    const { result } = renderHook(() => useToolConfirmationGate({ isMutating }));
    expect(result.current.needsConfirm({ name: 'create_task', args: {} })).toBe(true);
    expect(result.current.needsConfirm({ name: 'list_tasks', args: {} })).toBe(false);
  });

  it('honours a mid-run toggle — the invariant the copies existed to preserve', () => {
    // A run captures `needsConfirm` ONCE at start. Reading captured state instead of a
    // ref is what made a user who ticked auto-approve keep getting prompted for the rest
    // of an in-flight run.
    const { result } = renderHook(() => useToolConfirmationGate({ isMutating }));
    const capturedAtRunStart = result.current.needsConfirm;
    expect(capturedAtRunStart({ name: 'create_task', args: {} })).toBe(true);

    act(() => result.current.setAutoApprove(true));

    expect(capturedAtRunStart({ name: 'create_task', args: {} })).toBe(false);
  });

  it('keeps needsConfirm referentially STABLE across a toggle', () => {
    // An identity change here would tear down and restart the conversation.
    const { result } = renderHook(() => useToolConfirmationGate({ isMutating }));
    const before = result.current.needsConfirm;
    act(() => result.current.setAutoApprove(true));
    expect(result.current.needsConfirm).toBe(before);
  });

  it('mirrors the flag into state so the toggle can render itself', () => {
    const { result } = renderHook(() => useToolConfirmationGate({ isMutating }));
    expect(result.current.autoApprove).toBe(false);
    act(() => result.current.setAutoApprove(true));
    expect(result.current.autoApprove).toBe(true);
  });

  it('starts from defaultOn when nothing is persisted', () => {
    const { result } = renderHook(() =>
      useToolConfirmationGate({ isMutating, defaultOn: true, persistence: memoryPersistence() }),
    );
    expect(result.current.autoApprove).toBe(true);
    expect(result.current.needsConfirm({ name: 'create_task', args: {} })).toBe(false);
  });

  it('a stored OFF beats a defaultOn — an explicit choice is preserved', () => {
    const { result } = renderHook(() =>
      useToolConfirmationGate({ isMutating, defaultOn: true, persistence: memoryPersistence(false) }),
    );
    expect(result.current.autoApprove).toBe(false);
  });

  it('writes the preference through on change', () => {
    const persistence = memoryPersistence();
    const { result } = renderHook(() => useToolConfirmationGate({ isMutating, persistence }));
    act(() => result.current.setAutoApprove(true));
    expect(persistence.value).toBe(true);
    act(() => result.current.setAutoApprove(false));
    expect(persistence.value).toBe(false);
  });

  it('is session-only when no persistence is supplied', () => {
    const { result, unmount } = renderHook(() => useToolConfirmationGate({ isMutating }));
    act(() => result.current.setAutoApprove(true));
    unmount();
    const fresh = renderHook(() => useToolConfirmationGate({ isMutating }));
    expect(fresh.result.current.autoApprove).toBe(false);
  });
});

describe('localStorageConfirmationPersistence', () => {
  it('round-trips a preference', () => {
    const p = localStorageConfirmationPersistence('bf.test.autoApprove');
    p.write(true);
    expect(p.read()).toBe(true);
    p.write(false);
    expect(p.read()).toBe(false);
  });

  it('reports undefined — not a default — when nothing is stored', () => {
    // The distinction matters: "never chosen" takes the host's default, "chosen off"
    // must survive a host whose default is on.
    expect(localStorageConfirmationPersistence('bf.test.never-set').read()).toBeUndefined();
  });

  it('degrades to "not persisted" when storage throws rather than breaking render', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage partitioned');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage partitioned');
    });
    try {
      const p = localStorageConfirmationPersistence('bf.test.blocked');
      expect(p.read()).toBeUndefined();
      expect(() => p.write(true)).not.toThrow();
    } finally {
      spy.mockRestore();
      setSpy.mockRestore();
    }
  });
});
