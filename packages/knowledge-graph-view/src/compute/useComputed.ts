/**
 * ONE hook for every heavy computation a view needs: `useComputed(kind, input, deps, initial)` returns the latest result
 * and whether a newer one is on its way. The work runs in the graph compute worker (or, where there is none, in idle steps
 * on the main thread); the component cannot tell which, and renders the same once the result arrives.
 *
 * `deps` lists what `input` reads, exactly as `useMemo` deps do: a change cancels the request in flight and asks again.
 * Until the first answer the value is `initial` (null shows a component's "laying out" state). When `deps` change the
 * previous answer stays until the new one lands, unless `keep` is false, which clears it (an answer to a question nobody asks
 * any more). A task that fails settles on `failed` (default `initial`) and is logged.
 *
 * `inline` runs the work in the same render instead, with the same handler: for graphs small enough that a round trip would
 * cost more than the work (a small graph paints complete on its first frame). `enabled: false` asks for nothing.
 */

import { useEffect, useMemo, useState } from 'react';
import { getComputeClient } from './client';
import type { KindInput, KindResult } from './kinds';
import type { TaskKind } from './protocol';

export interface ComputeOptions<R> {
    enabled?: boolean;
    inline?: boolean;
    keep?: boolean;
    failed?: R | null;
}

export interface Computed<R> { value: R | null; pending: boolean }

interface Settled<R> { value: R | null; settled: boolean }

export function useComputed<K extends TaskKind>(
    kind: K, input: KindInput<K>, deps: readonly unknown[], initial: KindResult<K> | null, opts: ComputeOptions<KindResult<K>> = {},
): Computed<KindResult<K>> {
    const { enabled = true, inline = false, keep = true, failed = initial } = opts;
    const client = getComputeClient();
    const sync = enabled && inline;
    // `input` is built from `deps` by the caller; both the memo and the effect list exactly them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const now = useMemo(() => (sync ? client.runSync(kind, input) : null), [client, kind, sync, ...deps]);
    const [state, setState] = useState<Settled<KindResult<K>>>({ value: initial, settled: false });
    useEffect(() => {
        if (!enabled || inline) return undefined;
        client.retain();
        setState((s) => (keep ? (s.settled ? { value: s.value, settled: false } : s) : { value: initial, settled: false }));
        const cancel = client.run(kind, input, {
            done: (value) => setState({ value, settled: true }),
            fail: (error) => { console.error(`useComputed: ${kind} failed`, error); setState({ value: failed, settled: true }); },
        });
        return () => { cancel(); client.release(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, kind, enabled, inline, ...deps]);
    const value = sync ? now : enabled ? state.value : initial;
    return { value: value ?? initial, pending: enabled && !inline && !state.settled };
}
