/**
 * Stop was pressed and the host is still finishing the file in hand: a card that says no new file starts and what is being saved, with the bar frozen
 * where it was and how long it has waited. How long is DERIVED from when Stop was pressed (`since`, held by the review's state or by the panel for a host-run
 * review), never from when this card mounted. After `STUCK_AFTER_MS` with no word from the host it says so (the footer then offers Force stop).
 */

import { useEffect, useState } from 'react';
import type { ReviewProgress } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { STUCK_AFTER_MS } from '../../reviewTimings';
import { card } from '../../styles';
import { Bar } from '../drawers/ui';
import { TYPE } from '../ui/type';

/** Milliseconds since `since` (epoch ms), ticking every second while it is set; 0 when it is not. */
export function useWaitedSince(since: number | undefined): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (since === undefined) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [since]);
    return since === undefined ? 0 : Math.max(0, now - since);
}

/** True once the stop at `since` has waited `STUCK_AFTER_MS`. */
export const useStuckSince = (since: number | undefined): boolean => useWaitedSince(since) >= STUCK_AFTER_MS;

export interface ReviewStoppingProps {
    labels: KnowledgeGraphLabels;
    /** The last progress before Stop: the bar stays where it was. */
    progress?: ReviewProgress | undefined;
    /** When Stop was pressed (epoch ms). */
    since: number;
}

export function ReviewStopping({ labels, progress, since }: ReviewStoppingProps) {
    const r = labels.surface.run.review;
    const waited = useWaitedSince(since);
    return (
        <section data-testid="kg-review-stopping" aria-live="polite" style={{ ...card, display: 'grid', gap: 8 }}>
            <strong style={TYPE.subtitle}>{r.stoppingTitle}</strong>
            <p style={{ ...TYPE.body, margin: 0 }}>{r.stoppingBody}</p>
            {progress && progress.total > 0 && <Bar frac={progress.done / progress.total} label={labels.phases[progress.phase]} />}
            <p style={{ ...TYPE.meta, margin: 0 }}>{fillTemplate(r.stoppingWait, { seconds: Math.floor(waited / 1000) })}</p>
            {waited >= STUCK_AFTER_MS && <p role="status" style={{ ...TYPE.body, margin: 0 }}>{r.stoppingStuck}</p>}
        </section>
    );
}
