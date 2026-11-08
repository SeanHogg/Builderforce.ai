/**
 * ONE hook for every heavy computation a view needs: `useComputed(kind, input, deps, initial)` returns the latest result
 * and whether a newer one is on its way. The work runs in the graph compute worker (or, where there is none, in idle steps
 * on the main thread); the component cannot tell which, and renders the same once the result arrives.
 *
 * `deps` lists what `input` reads, exactly as `useMemo` deps do: a change cancels the request in flight and asks again.
 * Until the first answer the value is `initial` (null shows a component's "laying out" state). When `deps` change the
 * previous answer stays until the new one lands, so a view does not blank while it recomputes. `scope` narrows that: the
 * answer is dropped (back to `initial`, in the same render) when any entry of `scope` changes, because it answers a question
 * nobody asks any more (a different graph); `keep: false` is `scope = deps`. A task that fails settles on `failed` (default
 * `initial`) and is logged.
 *
 * `inline` runs the work in the same render instead, with the same handler: for graphs small enough that a round trip would
 * cost more than the work (a small graph paints complete on its first frame). `enabled: false` asks for nothing.
 */

import { useEffect, useMemo, useState } from 'react';
import { getComputeClient } from './sharedClient';
import type { KindInput, KindResult } from './kinds';
import type { TaskKind } from './protocol';

export interface ComputeOptions<R> {
    enabled?: boolean;
    inline?: boolean;
    /** False drops the previous answer on any change of `deps`. */
    keep?: boolean;
    /** Drops the previous answer when any of these change (default: nothing does). */
    scope?: readonly unknown[];
    failed?: R | null;
}

export interface Computed<R> { value: R | null; pending: boolean }

interface Answer<R> { value: R | null; settled: boolean; scope: readonly unknown[] }

const NO_SCOPE: readonly unknown[] = [];
const same = (a: readonly unknown[], b: readonly unknown[]): boolean => a === b || (a.length === b.length && a.every((x, i) => Object.is(x, b[i])));

export function useComputed<K extends TaskKind>(
    kind: K, input: KindInput<K>, deps: readonly unknown[], initial: KindResult<K> | null, opts: ComputeOptions<KindResult<K>> = {},
): Computed<KindResult<K>> {
    const { enabled = true, inline = false, keep = true, failed = initial } = opts;
    const scope = opts.scope ?? (keep ? NO_SCOPE : deps);
    const client = getComputeClient();
    const sync = enabled && inline;
    // `input` is built from `deps` by the caller; both the memo and the effect list exactly them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const now = useMemo(() => (sync ? client.runSync(kind, input) : null), [client, kind, sync, ...deps]);
    const [answer, setAnswer] = useState<Answer<KindResult<K>>>({ value: initial, settled: false, scope });
    useEffect(() => {
        if (!enabled || inline) return undefined;
        client.retain();
        setAnswer((a) => (same(a.scope, scope) ? (a.settled ? { ...a, settled: false } : a) : { value: initial, settled: false, scope }));
        const cancel = client.run(kind, input, {
            done: (value) => setAnswer({ value, settled: true, scope }),
            fail: (error) => { console.error(`useComputed: ${kind} failed`, error); setAnswer({ value: failed, settled: true, scope }); },
        });
        return () => { cancel(); client.release(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, kind, enabled, inline, ...deps]);
    const current = same(answer.scope, scope);
    const value = sync ? now : enabled && current ? answer.value : initial;
    return { value: value ?? initial, pending: enabled && !inline && !(answer.settled && current) };
}
