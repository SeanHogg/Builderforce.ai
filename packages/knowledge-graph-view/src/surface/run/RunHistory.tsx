/**
 * The Reviews panel's past runs (PRD 41 A8), newest first. Each row: an outcome dot, when it started, its kind and outcome,
 * the time it took (right-aligned), a thin bar of the files read out of the plan, and a meta line (read of total, files per second,
 * the failures and the most common reason). Opening one shows its detail in the same panel.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { quietButton } from '../../styles';
import type { ReviewRunSummary } from '../../types';
import { Bar, Section } from '../drawers/ui';
import { TYPE } from '../ui/type';
import { kindKey, outcomeKey, rateText, reasonKind, runDurationMs, spanText, whenText, type ReasonKind } from './runModel';
import { extractProgress, paceOf } from './runPace';
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

const DOT: Record<ReturnType<typeof outcomeKey>, ThemeTone> = { running: 'accent', done: 'agrees', stopped: 'cycle', failed: 'violation', interrupted: 'muted' };

/** The reason most failures of the run share, when the summary's report lists them. */
export function topReason(failures: readonly { reason: string }[] | undefined): ReasonKind | undefined {
    if (!failures || failures.length === 0) return undefined;
    const counts = new Map<ReasonKind, number>();
    for (const f of failures) counts.set(reasonKind(f.reason), (counts.get(reasonKind(f.reason)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

function Row({ run, labels, shown, onOpen }: { run: ReviewRunSummary; labels: KnowledgeGraphLabels; shown: boolean; onOpen(id: string): void }) {
    const t = labels.surface.run;
    const r = t.review;
    const kind = t.kinds[kindKey(run.kind)];
    const outcome = outcomeKey(run);
    const started = whenText(run.startedAt);
    const read = extractProgress(run);
    const pace = paceOf(run);
    const why = topReason(run.report?.failures);
    const meta = [
        read && fillTemplate(r.rowRead, { read: read.done.toLocaleString(), total: read.total.toLocaleString() }),
        pace && fillTemplate(r.rowRate, { rate: rateText(pace.rate) }),
        run.failureCount > 0 && (why ? fillTemplate(r.rowFailuresWhy, { count: run.failureCount, reason: t.reasons[why] }) : fillTemplate(r.rowFailures, { count: run.failureCount })),
    ].filter((x): x is string => typeof x === 'string');
    return (
        <li>
            <button
                type="button" aria-label={fillTemplate(t.historyOpen, { kind, started })} aria-current={shown ? 'true' : undefined} onClick={() => onOpen(run.id)}
                style={{ ...quietButton, width: '100%', height: 'auto', padding: '8px 10px', borderRadius: 10, whiteSpace: 'normal', textAlign: 'start', display: 'grid', gap: 4, borderColor: shown ? cssVar('accent') : cssVar('border') }}
            >
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, flex: 'none', background: cssVar(DOT[outcome]) }} />
                    <span style={{ ...TYPE.subtitle, flex: 1, minWidth: 0 }}>{started}</span>
                    <span style={TYPE.monoValue}>{spanText(labels, runDurationMs(run))}</span>
                </span>
                <span style={TYPE.meta}>{fillTemplate(t.headline, { kind, outcome: t.outcomes[outcome] })}</span>
                {read && <Bar frac={read.total > 0 ? read.done / read.total : 0} label={r.rowRead.replace('{read}', String(read.done)).replace('{total}', String(read.total))} height={4} tone={outcome === 'failed' ? 'violation' : 'accent'} />}
                {meta.length > 0 && <span style={TYPE.meta}>{meta.join(' · ')}</span>}
            </button>
        </li>
    );
}

export function RunHistory({ history, labels, shownId, onOpen, openFailed }: RunHistoryProps) {
    const t = labels.surface.run;
    return (
        <Section title={t.historyTitle}>
            {history.loading && history.runs.length === 0 ? <p role="status" style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.historyLoading}</p>
                : history.failed ? <p role="alert" style={{ margin: 0 }}>{t.historyFailed}</p>
                    : history.runs.length === 0 ? <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.historyNone}</p> : (
                        <ul data-testid="kg-run-history" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                            {history.runs.map((r) => <Row key={r.id} run={r} labels={labels} shown={r.id === shownId} onOpen={onOpen} />)}
                        </ul>
                    )}
            {openFailed && <p role="alert" style={{ margin: 0 }}>{t.runUnavailable}</p>}
        </Section>
    );
}
