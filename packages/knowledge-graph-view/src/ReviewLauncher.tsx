/**
 * "Review a folder": one button when the host has one way to pick a folder, else the
 * host's targets (this workspace, a folder on this device, a connected drive). Each press
 * starts the review INSIDE the click — a picker that needs the gesture opens there.
 */

import { useEffect, useRef, useState } from 'react';
import type { KnowledgeGraphLabels } from './labels';
import { button, primaryButton } from './styles';
import type { KnowledgeGraphSource, ReviewRequest, ReviewTarget } from './types';

export interface ReviewLauncherProps {
    source: KnowledgeGraphSource;
    labels: KnowledgeGraphLabels;
    start(req: ReviewRequest): void;
    primary?: boolean;
    /** Arrive on it: its targets shown and the button focused (a host's "Choose a folder to review" chip). */
    defaultOpen?: boolean;
}

export function ReviewLauncher({ source, labels, start, primary = true, defaultOpen = false }: ReviewLauncherProps) {
    const [targets, setTargets] = useState<ReviewTarget[]>([]);
    const [open, setOpen] = useState(defaultOpen);
    const buttonRef = useRef<HTMLButtonElement>(null);
    // Focus only: the picker itself still needs the person's own press (a gesture).
    useEffect(() => { if (defaultOpen) buttonRef.current?.focus(); }, [defaultOpen]);
    useEffect(() => {
        let live = true;
        source.targets?.().then((t) => { if (live) setTargets(t); }).catch(() => undefined);
        return () => { live = false; };
    }, [source]);

    if (!source.review) return null;
    const style = primary ? primaryButton : button;
    if (targets.length <= 1) {
        const only = targets[0];
        return <button ref={buttonRef} type="button" style={style} onClick={() => start(only ? { target: only.id } : { pick: true })}>{labels.reviewFolder}</button>;
    }
    return (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
            <button ref={buttonRef} type="button" style={style} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{labels.reviewFolder}</button>
            {open && (
                <ul aria-label={labels.reviewTargetsLabel} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {targets.map((t) => (
                        <li key={t.id}>
                            <button type="button" style={{ ...button, whiteSpace: 'normal', textAlign: 'start' }} onClick={() => { setOpen(false); start({ target: t.id }); }}>
                                {labels.targets[t.kind]}{t.title ? ` · ${t.title}` : ''}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
