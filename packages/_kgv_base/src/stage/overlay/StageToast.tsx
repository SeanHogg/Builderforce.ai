/**
 * A short message over the stage (a lens's references, Follow on or off, nothing to step into): one line near the bottom
 * of the map that clears itself. The owner calls `useStageToast()` once and renders `<StageToast>`; a later message
 * replaces the one on show and restarts the timer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';

export const TOAST_MS = 2600;

export interface StageToastState {
    message: string | null;
    show(text: string): void;
}

export function useStageToast(): StageToastState {
    const [message, setMessage] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const show = useCallback((text: string) => {
        if (timer.current) clearTimeout(timer.current);
        setMessage(text);
        timer.current = setTimeout(() => { timer.current = null; setMessage(null); }, TOAST_MS);
    }, []);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    return { message, show };
}

export function StageToast({ message }: { message: string | null }) {
    if (!message) return null;
    return (
        <div
            role="status" aria-live="polite" data-stage-toast
            style={{
                position: 'absolute', bottom: 44, left: '50%', transform: 'translateX(-50%)', maxWidth: '70%', zIndex: 3, padding: '4px 10px', borderRadius: 8,
                background: cssVar('panel'), color: cssVar('text'), border: `1px solid ${cssVar('border')}`, pointerEvents: 'none', ...TYPE.meta,
            }}
        >
            {message}
        </div>
    );
}
