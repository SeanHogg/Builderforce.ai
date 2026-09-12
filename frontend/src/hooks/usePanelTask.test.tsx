import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/apiClient';
import { ApiTransportError } from '@/lib/errors/transportFailure';
import { usePanelTask } from './usePanelTask';

describe('usePanelTask', () => {
  // The global next-intl mock returns the KEY, so these assert which message was chosen.
  it('reduces a rejection through useErrorMessage: transport translated, signed-out silent, silence falls back', async () => {
    const { result } = renderHook(() => usePanelTask());
    await act(async () => { await result.current.run(async () => { throw new ApiTransportError('offline', '/api/x', 'GET'); }); });
    expect(result.current.error).toBe('globalError.transport.offline');

    await act(async () => { await result.current.run(async () => { throw new ApiRequestError('Unauthorized', 401, undefined, undefined, true); }); });
    expect(result.current.error).toBeNull();

    await act(async () => { await result.current.run(async () => { throw 'bare string'; }); });
    expect(result.current.error).toBe('common.actionFailed');
  });

  it('runs an action: busy while in flight, the success notice after, the value returned', async () => {
    const { result } = renderHook(() => usePanelTask());
    let resolve!: (v: number) => void;
    let pending!: Promise<number | undefined>;
    act(() => { pending = result.current.run(() => new Promise<number>((r) => { resolve = r; }), { success: 'saved' }); });
    expect(result.current.busy).toBe(true);
    await act(async () => { resolve(7); await pending; });
    await expect(pending).resolves.toBe(7);
    expect(result.current.busy).toBe(false);
    expect(result.current.notice).toBe('saved');
    expect(result.current.error).toBeNull();
  });

  it('builds the success sentence from the resolved value when given a function', async () => {
    const { result } = renderHook(() => usePanelTask());
    await act(async () => {
      await result.current.run(async () => ({ segments: 2 }), { success: (sent) => `sent in ${sent.segments}` });
    });
    expect(result.current.notice).toBe('sent in 2');
  });

  it('resolves a rejection to undefined, preferring the thrown message over the fallback', async () => {
    const { result } = renderHook(() => usePanelTask());
    let value: unknown = 'unset';
    await act(async () => {
      value = await result.current.run(async () => { throw new Error('quota exceeded'); }, { success: 'nope', failure: 'generic' });
    });
    expect(value).toBeUndefined();
    expect(result.current.error).toBe('quota exceeded');
    expect(result.current.notice).toBeNull();

    await act(async () => { await result.current.run(async () => { throw new Error(''); }, { failure: 'generic' }); });
    expect(result.current.error).toBe('generic');
  });

  it('clears the previous messages when the next action starts, and fail() lands in the same slot', async () => {
    const { result } = renderHook(() => usePanelTask());
    await act(async () => { await result.current.run(async () => 1, { success: 'first' }); });
    act(() => result.current.fail('pick one'));
    expect(result.current.notice).toBeNull();
    expect(result.current.error).toBe('pick one');
    act(() => result.current.clear());
    expect(result.current.error).toBeNull();
  });
});
