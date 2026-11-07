/**
 * The Run panel's failures (PRD 41 A8): every file the run could not finish, with the phase and a
 * short reason in words (the raw text is the tooltip), **Retry** for one and **Retry all**. A retry is a
 * review request the host answers with the normal plan and confirm; the buttons are offered (`onRetry`) but
 * enabled (`canRetry`) only for the root's latest, ended run while no review is going.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { button, primaryButton } from '../../styles';
import type { StoredReviewRun } from '../../types';
import { Section } from '../drawers/ui';
import { counted } from '../plural';
import { stationName } from '../stationName';
import { TYPE } from '../ui/type';
import { failureCountOf, reasonKind } from './runModel';

export interface RunFailuresProps {
    run: StoredReviewRun;
    labels: KnowledgeGraphLabels;
    /** Absent ⇒ the host cannot review, so there is no Retry. */
    onRetry?: ((paths: string[]) => void) | undefined;
    /** Retry may be pressed now. */
    canRetry?: boolean | undefined;
}

export function RunFailures({ run, labels, onRetry, canRetry = false }: RunFailuresProps) {
    const t = labels.surface.run;
    const failures = run.failures;
    const total = failureCountOf(run);
    const paths = [...new Set(failures.map((f) => f.path))];
    return (
        <Section title={total > 0 ? counted(labels, 'runFailure', total) : t.failuresTitle}>
            {total === 0 ? <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.failuresNone}</p> : (
                <>
                    {failures.length < total && <p data-testid="kg-run-failures-truncated" style={{ ...TYPE.bodyMuted, margin: 0 }}>{fillTemplate(t.failuresTruncated, { shown: String(failures.length), total: String(total) })}</p>}
                    {onRetry && (
                        <div>
                            <button type="button" style={primaryButton} disabled={!canRetry} onClick={() => onRetry(paths)}>
                                {counted(labels, 'runRetryAll', paths.length)}
                            </button>
                        </div>
                    )}
                    <ul data-testid="kg-run-failures" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                        {failures.map((f, i) => (
                            <li key={`${i}-${f.path}`} style={{ display: 'flex', gap: '2px 10px', alignItems: 'baseline', flexWrap: 'wrap', borderBottom: `1px solid ${cssVar('border')}`, paddingBottom: 4 }}>
                                <span title={f.path} style={{ ...TYPE.monoName, flex: '1 1 140px', minWidth: 0, overflowWrap: 'anywhere' }}>{stationName(f.path)}</span>
                                <span style={TYPE.meta}>{labels.phases[f.phase]}</span>
                                <span title={f.reason} style={{ ...TYPE.status, color: cssVar('violation') }}>{t.reasons[reasonKind(f.reason)]}</span>
                                {onRetry && (
                                    <button type="button" style={button} disabled={!canRetry} aria-label={fillTemplate(t.retryAria, { path: f.path })} onClick={() => onRetry([f.path])}>
                                        {t.retry}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </Section>
    );
}
