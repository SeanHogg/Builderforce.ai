/**
 * The Review tab while a review runs: the step list with the current step highlighted (count, start the workers, read and save with its bar, rate, ETA and
 * workers busy, judge, update the map and upload), the few lines on where the time goes, and what is being read now with a link to every step.
 * Every number is the run record's (or the review's own progress before the first record arrives). Stop lives in the pinned footer.
 */

import { useState, type ReactNode } from 'react';
import type { ReviewProgress } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { quietButton } from '../../styles';
import type { StoredReviewRun } from '../../types';
import { Bar } from '../drawers/ui';
import { counted } from '../plural';
import { stationName } from '../stationName';
import { TYPE } from '../ui/type';
import { nowSteps, timeLines, type StepState } from './nowModel';
import { RunSteps } from './RunSteps';
import { activePhase, lanesOf, rateText, spanText } from './runModel';

export interface ReviewNowProps {
    labels: KnowledgeGraphLabels;
    /** The live run record; null before the host posts its first. */
    run: StoredReviewRun | null;
    /** The review's own progress, for the count before a record exists. */
    progress?: ReviewProgress | undefined;
    /** The plan's judge budget, for the judge step before the record names one. */
    judgeFiles?: number | undefined;
    /** Opens a run in the Runs tab (the failures by reason, the slowest files). Absent ⇒ no such links. */
    onOpenRun?: ((runId: string) => void) | undefined;
}

const MARK: Record<StepState, string> = { done: '✓', active: '●', pending: '○' };

function Step({ state, name, detail, children }: { state: StepState; name: string; detail?: ReactNode; children?: ReactNode }) {
    return (
        <li data-state={state} aria-current={state === 'active' ? 'step' : undefined} style={{ display: 'grid', gap: 6 }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span aria-hidden="true" style={{ ...TYPE.status, width: 14, textAlign: 'center', flex: 'none', color: cssVar(state === 'done' ? 'agrees' : state === 'active' ? 'accent' : 'muted') }}>{MARK[state]}</span>
                <span style={{ ...(state === 'active' ? TYPE.subtitle : TYPE.body), flex: 1, minWidth: 0 }}>{name}</span>
                {detail !== undefined && <span style={TYPE.meta}>{detail}</span>}
            </span>
            {children}
        </li>
    );
}

/** How many of the files being read are named; the rest are a count that opens every step. */
const READING_SHOWN = 3;

export function ReviewNow({ labels, run, progress, judgeFiles, onOpenRun }: ReviewNowProps) {
    const r = labels.surface.run.review;
    const t = labels.surface.run;
    const [every, setEvery] = useState(false);
    const steps = run ? nowSteps(run, judgeFiles) : null;
    const read = steps?.read.progress;
    // Before the first record the review's own count stands in; it is only a count while files are being read.
    const done = read?.done ?? (progress?.phase === 'extract' ? progress.done : 0);
    const total = read?.total ?? (progress?.phase === 'extract' ? progress.total : 0);
    const pct = read?.pct ?? (total > 0 ? Math.round((done / total) * 100) : undefined);
    // Map the code: the record's `analyse` phase, else the review's own count. A total of 0 or 1 is "not known yet": an indeterminate bar.
    const mapping = steps?.analyse ?? (progress?.phase === 'analyse' ? { state: 'active' as StepState, done: progress.done, total: progress.total } : undefined);
    const lines = run ? timeLines(run) : {};
    const lanes = run ? lanesOf(run, activePhase(run)).filter((l) => l.path) : [];
    const sec = (ms: number) => String(Math.max(1, Math.round(ms / 1000)));
    const dur = (ms: number) => spanText(labels, ms);
    const where = [
        lines.timeouts && (lines.timeouts.limitMs !== undefined
            ? fillTemplate(r.whereTimeouts, { files: counted(labels, 'file', lines.timeouts.count), seconds: sec(lines.timeouts.limitMs) })
            : fillTemplate(r.whereTimedOut, { files: counted(labels, 'file', lines.timeouts.count) })),
        lines.waitMs !== undefined && fillTemplate(r.whereWait, { seconds: sec(lines.waitMs) }),
        lines.stallMs !== undefined && fillTemplate(r.whereStall, { seconds: sec(lines.stallMs) }),
    ].filter((x): x is string => typeof x === 'string');
    const readDetail = read?.rate !== undefined && steps?.read.state === 'active'
        ? [read.etaMs !== undefined && read.etaMs > 0 ? fillTemplate(r.stepPace, { rate: rateText(read.rate), eta: dur(read.etaMs) }) : fillTemplate(r.stepPaceNoEta, { rate: rateText(read.rate) }),
            lanes.length > 0 && fillTemplate(r.workersBusy, { count: lanes.length })].filter(Boolean).join(' · ')
        : undefined;

    return (
        <section data-testid="kg-review-now" style={{ display: 'grid', gap: 16 }}>
            {!run && progress && (
                <div data-testid="kg-review-progress" style={{ display: 'grid', gap: 6 }}>
                    <p role="status" style={{ ...TYPE.subtitle, margin: 0 }}>{fillTemplate(labels.reviewProgress, { phase: labels.phases[progress.phase], done: progress.done, total: progress.total })}</p>
                    {progress.total > 0 && <Bar frac={progress.done / progress.total} label={labels.phases[progress.phase]} />}
                    {progress.path && <p style={{ ...TYPE.meta, margin: 0, overflowWrap: 'anywhere' }}>{progress.path}</p>}
                </div>
            )}
            <ol data-testid="kg-review-steps" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
                {steps && (
                    <>
                        <Step
                            state={steps.count.state} name={r.stepCount}
                            detail={[steps.count.files !== undefined && counted(labels, 'file', steps.count.files), steps.count.ms !== undefined && dur(steps.count.ms)].filter(Boolean).join(' · ') || undefined}
                        />
                        <Step state={steps.workers.state} name={r.stepWorkers} detail={steps.workers.ms !== undefined ? dur(steps.workers.ms) : undefined} />
                    </>
                )}
                <Step state={steps?.read.state ?? (progress?.phase === 'analyse' ? 'done' : 'active')} name={r.stepRead} detail={readDetail}>
                    {total > 0 && (
                        <>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                <strong data-testid="kg-review-count" style={{ ...TYPE.figure, flex: 1, minWidth: 0 }}>{fillTemplate(r.filesRead, { done: done.toLocaleString(), total: total.toLocaleString() })}</strong>
                                <span style={TYPE.monoValue}>{pct}%</span>
                            </div>
                            <Bar frac={done / total} label={labels.phases.extract} height={8} />
                        </>
                    )}
                </Step>
                {mapping && (
                    <Step state={mapping.state} name={r.stepAnalyse} detail={mapping.state === 'active' && mapping.total > 1 ? fillTemplate(t.phaseProgress, { done: mapping.done, total: mapping.total }) : undefined}>
                        {mapping.state === 'active' && (mapping.total > 1
                            ? <Bar frac={mapping.done / mapping.total} label={labels.phases.analyse} height={8} />
                            : <Bar frac={0} indeterminate label={labels.phases.analyse} height={8} />)}
                    </Step>
                )}
                {steps?.judge && (
                    <Step
                        state={steps.judge.state} name={fillTemplate(r.stepJudge, { count: steps.judge.count })}
                        detail={steps.judge.state === 'pending' ? r.stepJudgeWait : fillTemplate(t.phaseProgress, { done: steps.judge.done, total: steps.judge.total })}
                    />
                )}
                {steps && <Step state={steps.update.state} name={r.stepUpdate} detail={steps.update.state === 'pending' ? r.stepUpdateWait : undefined} />}
            </ol>
            {where.length > 0 && (
                <section style={{ display: 'grid', gap: 4 }}>
                    <h3 style={TYPE.sectionHeading}>{r.whereTitle}</h3>
                    <ul data-testid="kg-review-where" style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 2, ...TYPE.body }}>
                        {where.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                    {run && onOpenRun && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {lines.timeouts && <button type="button" data-testid="kg-see-failures" style={quietButton} onClick={() => onOpenRun(run.id)}>{r.seeThem}</button>}
                            <button type="button" data-testid="kg-see-slowest" style={quietButton} onClick={() => onOpenRun(run.id)}>{r.slowestLink}</button>
                        </div>
                    )}
                </section>
            )}
            {run && (
                <section style={{ display: 'grid', gap: 6 }}>
                    <h3 style={TYPE.sectionHeading}>{r.readingNow}</h3>
                    {lanes.length > 0 && (
                        <ul data-testid="kg-review-reading" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
                            {lanes.slice(0, READING_SHOWN).map((l) => <li key={`${l.phase}-${l.id}`} title={l.path} style={{ ...TYPE.monoName, overflowWrap: 'anywhere' }}>{stationName(l.path!)}</li>)}
                        </ul>
                    )}
                    <div><button type="button" style={quietButton} aria-expanded={every} onClick={() => setEvery((v) => !v)}>{lanes.length > READING_SHOWN ? fillTemplate(r.moreEvery, { count: lanes.length - READING_SHOWN }) : r.toggleSteps}</button></div>
                    {every && <RunSteps key={run.id} run={run} labels={labels} />}
                </section>
            )}
        </section>
    );
}
