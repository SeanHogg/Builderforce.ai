/**
 * The pinpoint run: an image goes to `source.pinpoint(blob, rootId)`, and the state is what the
 * input draws: nothing yet, reading (with the thumbnail), failed, rejected (not an image, or over
 * the size limit) or done with the host's result. A newer image supersedes an older one still in
 * flight. The thumbnail's object URL is revoked when it is replaced, cleared, or the input goes
 * away; a new root, or a run the source cannot take, leaves nothing of the old state behind.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeGraphSource, PinpointResult } from '../types';

/** The largest screenshot sent (the same 8 MB the VS Code host accepts). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type PinpointState =
    | { status: 'idle' }
    | { status: 'invalid'; reason: 'type' | 'size' }
    | { status: 'reading'; thumb?: string }
    | { status: 'failed'; thumb?: string }
    | { status: 'done'; thumb?: string; result: PinpointResult };

export interface PinpointRun {
    state: PinpointState;
    /** Reads an image; a file that is not an image, or is too large, is `invalid` and nothing is sent. */
    run(file: Blob): void;
    clear(): void;
}

const thumbOf = (blob: Blob): string | undefined => {
    try { return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : undefined; } catch { return undefined; }
};
const revoke = (url: string | undefined) => { if (url) try { URL.revokeObjectURL(url); } catch { /* nothing to free */ } };

export function usePinpoint(source: KnowledgeGraphSource, rootId: string | null, onMatches: (refs: string[], result: PinpointResult) => void): PinpointRun {
    const [state, setState] = useState<PinpointState>({ status: 'idle' });
    const seq = useRef(0);
    const thumb = useRef<string | undefined>(undefined);
    const onMatchesRef = useRef(onMatches);
    onMatchesRef.current = onMatches;
    const drop = () => { revoke(thumb.current); thumb.current = undefined; };
    const reset = useCallback(() => { seq.current += 1; drop(); setState({ status: 'idle' }); }, []);
    useEffect(() => () => { seq.current += 1; drop(); }, []);
    // Another root: the old screenshot, its thumbnail and any answer still in flight are not about this one.
    useEffect(() => { reset(); }, [rootId, reset]);

    const run = useCallback((file: Blob) => {
        const mine = ++seq.current;
        drop();
        if (!file.type.startsWith('image/')) { setState({ status: 'invalid', reason: 'type' }); return; }
        if (file.size > MAX_IMAGE_BYTES) { setState({ status: 'invalid', reason: 'size' }); return; }
        if (!source.pinpoint || !rootId) { setState({ status: 'idle' }); return; }
        const url = thumbOf(file);
        thumb.current = url;
        const t = url ? { thumb: url } : {};
        setState({ status: 'reading', ...t });
        source.pinpoint(file, rootId).then(
            (result) => {
                if (mine !== seq.current) return;
                setState({ status: 'done', ...t, result });
                const refs = result.matches.map((m) => m.ref);
                if (refs.length > 0) onMatchesRef.current(refs, result);
            },
            () => { if (mine === seq.current) setState({ status: 'failed', ...t }); },
        );
    }, [source, rootId]);

    return { state, run, clear: reset };
}
