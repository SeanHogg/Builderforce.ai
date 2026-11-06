/** Reads the host's recorded values for a path's stops (the optional `recordedValues` port) once per path; null when it has none or fails. */

import { useEffect, useState } from 'react';
import type { RecordedRun } from '../../fixPorts';
import type { KnowledgeGraphSource } from '../../types';

export function useRecordedRun(source: KnowledgeGraphSource | undefined, rootId: string | undefined, stopIds: readonly string[]): { run: RecordedRun | null; loading: boolean } {
    const key = stopIds.join('\u0000');
    const [state, setState] = useState<{ key: string; run: RecordedRun | null }>({ key: '', run: null });
    const available = !!source?.recordedValues && !!rootId && stopIds.length > 0;
    useEffect(() => {
        if (!available) return;
        let live = true;
        source!.recordedValues!(rootId!, [...stopIds]).then(
            (run) => { if (live) setState({ key, run }); },
            () => { if (live) setState({ key, run: null }); },
        );
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for stopIds
    }, [available, source, rootId, key]);
    return { run: available && state.key === key ? state.run : null, loading: available && state.key !== key };
}
