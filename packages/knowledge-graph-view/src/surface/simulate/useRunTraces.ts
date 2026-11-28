/**
 * The root's recorded runs (`source.runTraces`), read once per root and again when the host reports a data source changed
 * (`sourcesTick`), NOT per live graph patch. The previous runs stay while a re-read is in flight (no flicker); another root starts from
 * nothing. A failed read is reported through the source's decision log and leaves no runs (the transition table then falls back to its
 * references). A host without the port gives null.
 */

import { useEffect, useState } from 'react';
import type { KnowledgeGraphSource, RunTraces } from '../../types';
import { errorText } from '../../firstLoadGate';

export function useRunTraces(source: KnowledgeGraphSource | undefined, rootId: string | undefined, sourcesTick = 0): RunTraces | null {
    const read = source?.runTraces;
    const [state, setState] = useState<{ rootId: string; traces: RunTraces | null } | null>(null);
    useEffect(() => {
        if (!read || !rootId) return undefined;
        let live = true;
        read.call(source, rootId).then(
            (traces) => { if (live) setState({ rootId, traces }); },
            (error: unknown) => {
                if (!live) return;
                source?.decision?.({ kind: 'error', reason: `run traces read failed: ${errorText(error)}`, rootId });
                setState({ rootId, traces: null });
            },
        );
        return () => { live = false; };
    }, [read, source, rootId, sourcesTick]);
    return read && state && state.rootId === rootId ? state.traces : null;
}
