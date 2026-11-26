// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TryRequest, TryResponse } from '../../types';
import { useTryRequest } from './useTryRequest';

const req: TryRequest = { method: 'GET', url: 'http://localhost:3000/x' };
const res = (body: string): TryResponse => ({ status: 200, headers: {}, body, ms: 1 });

function deferred() {
    let resolve!: (r: TryResponse) => void;
    const promise = new Promise<TryResponse>((r) => { resolve = r; });
    return { promise, resolve };
}

describe('useTryRequest', () => {
    it('ignores an older answer that lands after a newer send', async () => {
        const first = deferred(), second = deferred();
        const answers = [first.promise, second.promise];
        const { result } = renderHook(() => useTryRequest(() => answers.shift()!));
        act(() => result.current.send(req));
        act(() => result.current.send(req));
        await act(async () => { second.resolve(res('new')); await second.promise; });
        await act(async () => { first.resolve(res('old')); await first.promise; });
        expect(result.current.state).toEqual({ phase: 'done', res: res('new') });
    });

    it('does not set state after unmount', async () => {
        const slow = deferred();
        const { result, unmount } = renderHook(() => useTryRequest(() => slow.promise));
        act(() => result.current.send(req));
        unmount();
        await act(async () => { slow.resolve(res('late')); await slow.promise; });
        expect(result.current.state).toEqual({ phase: 'sending' });
    });

    it('turns a synchronous throw into a failed send', async () => {
        const { result } = renderHook(() => useTryRequest((): Promise<TryResponse> => { throw new Error('no port'); }));
        await act(async () => { result.current.send(req); await Promise.resolve(); });
        expect(result.current.state).toEqual({ phase: 'failed', message: 'no port' });
    });

    it('does nothing without a port', () => {
        const { result } = renderHook(() => useTryRequest(undefined));
        act(() => result.current.send(req));
        expect(result.current.state).toEqual({ phase: 'idle' });
    });
});
