/**
 * The first read's status line: "Loading the knowledge graph…", then how long it has run (each
 * second), the host's step it is in now when the host says (`KnowledgeGraphSource.loadTrace`), and
 * past {@link SLOW_LOAD_MS} a Copy diagnostics button, so a stuck load can be reported from here
 * (the Diagnostics drawer is out of reach until a graph is drawn).
 */

import { useEffect, useState } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { SLOW_LOAD_MS } from '../loadDiagnostics';
import { muted } from '../styles';
import { CopyDiagnostics } from './run/CopyDiagnostics';

export interface LoadingProgress {
    /** The host phase the load is in now (`LOAD_PHASES`, or another id shown as it is). */
    phase?: string | undefined;
    /** The diagnostics text, taken when Copy is pressed. */
    diagnostics?: (() => string) | undefined;
}

/** "12 s", or "1 min 12 s" past a minute, in the reader's units. */
export function elapsedText(labels: KnowledgeGraphLabels, ms: number): string {
    const u = labels.surface.run.units;
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return fillTemplate(u.second, { count: seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes >= 60) return `${fillTemplate(u.hour, { count: Math.floor(minutes / 60) })} ${fillTemplate(u.minute, { count: minutes % 60 })}`;
    return `${fillTemplate(u.minute, { count: minutes })} ${fillTemplate(u.second, { count: seconds % 60 })}`;
}

export function LoadingStatus({ labels, progress }: { labels: KnowledgeGraphLabels; progress?: LoadingProgress | undefined }) {
    const [start] = useState(() => Date.now());
    const [now, setNow] = useState(start);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const elapsed = now - start;
    const phase = progress?.phase;
    const phaseName = phase ? (labels.loadPhases as Record<string, string>)[phase] ?? phase : undefined;
    return (
        <div data-testid="kg-loading" style={{ display: 'grid', gap: 6, justifyItems: 'start', minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
            <p role="status" style={{ ...muted, margin: 0 }}>{elapsed >= 1000 ? fillTemplate(labels.loadingElapsed, { elapsed: elapsedText(labels, elapsed) }) : labels.loading}</p>
            {phaseName && <p data-testid="kg-loading-phase" style={{ ...muted, margin: 0 }}>{fillTemplate(labels.loadingPhase, { phase: phaseName })}</p>}
            {elapsed > SLOW_LOAD_MS && (
                <>
                    <p style={{ ...muted, margin: 0 }}>{labels.loadingSlow}</p>
                    <CopyDiagnostics labels={labels} text={progress?.diagnostics} />
                </>
            )}
        </div>
    );
}
