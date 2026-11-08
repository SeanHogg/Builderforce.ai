/**
 * A run's failures grouped by reason, with the count of each. The stop the person pressed ("The review was stopped.") is not an error:
 * it reads "Cancelled by Stop (not errors)". Retry is offered on the timeout group when retrying is allowed.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { button } from '../../styles';
import type { StoredReviewRun } from '../../types';
import { Section } from '../drawers/ui';
import { counted } from '../plural';
import { TYPE } from '../ui/type';
import { reasonKind, type ReasonKind } from './runModel';

/** The reason text the host stamps on files a Stop left unfinished. */
export const STOPPED_REASON = 'The review was stopped.';

export type FailureGroupId = ReasonKind | 'cancelled';
export interface FailureGroup { id: FailureGroupId; count: number; paths: string[] }

/** Groups the failures by reason, largest first; Stop's own leftovers form the `cancelled` group. */
export function groupFailures(failures: StoredReviewRun['failures']): FailureGroup[] {
    const groups = new Map<FailureGroupId, FailureGroup>();
    for (const f of failures) {
        const id: FailureGroupId = f.reason.trim() === STOPPED_REASON ? 'cancelled' : reasonKind(f.reason);
        const g = groups.get(id) ?? { id, count: 0, paths: [] };
        g.count += 1;
        if (!g.paths.includes(f.path)) g.paths.push(f.path);
        groups.set(id, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
}

export interface FailuresByReasonProps {
    run: StoredReviewRun;
    labels: KnowledgeGraphLabels;
    onRetry?: ((paths: string[]) => void) | undefined;
    canRetry?: boolean | undefined;
}

export function FailuresByReason({ run, labels, onRetry, canRetry = false }: FailuresByReasonProps) {
    const t = labels.surface.run;
    const groups = groupFailures(run.failures);
    if (groups.length === 0) return null;
    return (
        <Section title={t.review.failedByReason}>
            <ul data-testid="kg-run-failure-groups" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                {groups.map((g) => (
                    <li key={g.id} data-reason={g.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${cssVar('border')}`, paddingBottom: 4 }}>
                        <span style={{ ...TYPE.body, flex: '1 1 140px', minWidth: 0 }}>{g.id === 'cancelled' ? t.review.cancelledByStop : t.reasons[g.id]}</span>
                        <span style={TYPE.monoValue}>{counted(labels, 'file', g.count)}</span>
                        {g.id === 'timeout' && onRetry && (
                            <button type="button" style={button} disabled={!canRetry} aria-label={fillTemplate(t.retryAria, { path: t.reasons.timeout })} onClick={() => onRetry(g.paths)}>{t.retry}</button>
                        )}
                    </li>
                ))}
            </ul>
        </Section>
    );
}
