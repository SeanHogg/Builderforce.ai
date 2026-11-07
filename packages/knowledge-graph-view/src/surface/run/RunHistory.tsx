/**
 * The Run panel's history (PRD 41 A8): the root's past runs, newest first, each with its kind, when
 * it started, how long it took, how it ended and its counts. Opening one shows it in the same panel,
 * frozen.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { quietButton } from '../../styles';
import { Section } from '../drawers/ui';
import { counted } from '../plural';
import { TYPE } from '../ui/type';
import { kindKey, outcomeKey, runDurationMs, spanText, whenText } from './runModel';
import type { RunHistoryRead } from './useReviewRunRecord';

export interface RunHistoryProps {
    history: RunHistoryRead;
    labels: KnowledgeGraphLabels;
    /** The run shown now (live or frozen): its row is marked. */
    shownId?: string | undefined;
    onOpen(runId: string): void;
    /** A run that was picked could not be opened. */
    openFailed?: boolean | undefined;
}

export function RunHistory({ history, labels, shownId, onOpen, openFailed }: RunHistoryProps) {
    const t = labels.surface.run;
    return (
        <Section title={t.historyTitle}>
            {history.loading && history.runs.length === 0 ? <p role="status" style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.historyLoading}</p>
                : history.failed ? <p role="alert" style={{ margin: 0 }}>{t.historyFailed}</p>
                    : history.runs.length === 0 ? <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.historyNone}</p> : (
                        <ul data-testid="kg-run-history" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                            {history.runs.map((r) => {
                                const kind = t.kinds[kindKey(r.kind)];
                                const started = whenText(r.startedAt);
                                return (
                                    <li key={r.id}>
                                        <button
                                            type="button" aria-label={fillTemplate(t.historyOpen, { kind, started })} aria-current={r.id === shownId ? 'true' : undefined}
                                            onClick={() => onOpen(r.id)}
                                            style={{
                                                ...quietButton, width: '100%', height: 'auto', padding: '6px 10px', borderRadius: 10, whiteSpace: 'normal', textAlign: 'start',
                                                display: 'grid', gap: 2, borderColor: r.id === shownId ? cssVar('accent') : cssVar('border'),
                                            }}
                                        >
                                            <span style={{ ...TYPE.subtitle, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                <span>{kind}</span>
                                                <span style={{ color: cssVar(r.outcome === 'failed' ? 'violation' : r.outcome === 'done' ? 'agrees' : 'muted') }}>{t.outcomes[outcomeKey(r)]}</span>
                                            </span>
                                            <span style={TYPE.meta}>{`${started} · ${spanText(labels, runDurationMs(r))}`}</span>
                                            <span style={TYPE.meta}>
                                                {r.report ? counted(labels, 'file', r.report.extracted) : null}
                                                {r.failureCount > 0 ? ` · ${counted(labels, 'runFailure', r.failureCount)}` : null}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
            {openFailed && <p role="alert" style={{ margin: 0 }}>{t.runUnavailable}</p>}
        </Section>
    );
}
