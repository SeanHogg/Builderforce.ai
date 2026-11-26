/**
 * One sandbox send: idle, sending, the response or the failure. A newer send (or an unmount)
 * makes an older answer irrelevant, so a slow response never overwrites the current one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TryRequest, TryResponse } from '../../types';

export type TryState =
    | { phase: 'idle' }
    | { phase: 'sending' }
    | { phase: 'done'; res: TryResponse }
    | { phase: 'failed'; message: string };

export function useTryRequest(tryRequest: ((req: TryRequest) => Promise<TryResponse>) | undefined): { state: TryState; send(req: TryRequest): void } {
    const [state, setState] = useState<TryState>({ phase: 'idle' });
    const turn = useRef(0);
    useEffect(() => () => { turn.current += 1; }, []);
    const send = useCallback((req: TryRequest) => {
        if (!tryRequest) return;
        const mine = ++turn.current;
        setState({ phase: 'sending' });
        // A port that throws before it returns a promise is a failed send, not an uncaught error.
        new Promise<TryResponse>((resolve) => resolve(tryRequest(req))).then(
            (res) => { if (turn.current === mine) setState({ phase: 'done', res }); },
            (error: unknown) => { if (turn.current === mine) setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) }); },
        );
    }, [tryRequest]);
    return { state, send };
}
