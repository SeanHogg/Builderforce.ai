/**
 * One run in detail (a past run, or the one that just stopped), inside the Reviews panel with a Back button: its timeline on the run's time
 * axis, its pace against the earlier runs, its failures by reason, its slowest files, what it left, then Copy diagnostics and Every step.
 */

import { useState } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { button, quietButton } from '../../styles';
import type { ReplicaState, StoredReviewRun } from '../../types';
import { Section } from '../drawers/ui';
import { counted } from '../plural';
import { TYPE } from '../ui/type';
import { CopyDiagnostics } from './CopyDiagnostics';
import { FailuresByReason } from './FailuresByReason';
import { RunAxis } from './RunAxis';
import { RunPaceBars } from './RunPaceBars';
import { RunSlowest } from './RunSlowest';
import { RunSteps } from './RunSteps';
import { RunTimeline } from './RunTimeline';
import { awaitingJudgeCount, kindKey, outcomeKey, runDurationMs, spanText, whenText } from './runModel';
import type { PaceRun } from './runPace';

export interface RunDetailProps {
    labels: KnowledgeGraphLabels;
    run: StoredReviewRun;
    /** The root's past runs, newest first, for the pace comparison. */
    history: readonly (PaceRun & { id: string })[];
    onBack(): void;
    onRetry?: ((paths: string[]) => void) | undefined;
    canRetry?: boolean | undefined;
    diagnosticsText?: (() => string) | undefined;
    /** Where the upload queue stands now, for a run still going; an ended run says where it stood then. */
    replica?: ReplicaState | undefined;
}

export function RunDetail({ labels, run, history, onBack, onRetry, canRetry, diagnosticsText, replica }: RunDetailProps) {
    const t = labels.surface.run;
    const r = t.review;
    const [steps, setSteps] = useState(false);
    const left = run.report;
    const waiting = awaitingJudgeCount(run);
    const dirty = (run.endedAt === undefined ? replica : run.replica)?.dirty;
    const rows = [
        left && fillTemplate(r.leftExtracted, { files: counted(labels, 'file', left.extracted) }),
        left && fillTemplate(r.leftStale, { count: left.staleMarked }),
        waiting > 0 && fillTemplate(r.leftAwaiting, { files: counted(labels, 'file', waiting) }),
        dirty !== undefined && fillTemplate(r.leftUpload, { count: dirty }),
    ].filter((x): x is string => typeof x === 'string');
    return (
        <div data-testid="kg-run-detail" style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" style={quietButton} onClick={onBack}>{`← ${r.back}`}</button>
                <div style={{ flex: '1 1 160px', minWidth: 0, display: 'grid', gap: 2 }}>
                    <strong style={TYPE.subtitle}>{fillTemplate(t.headline, { kind: t.kinds[kindKey(run.kind)], outcome: t.outcomes[outcomeKey(run)] })}</strong>
                    <span style={TYPE.meta}>{fillTemplate(t.startedAt, { time: whenText(run.startedAt) })} · {fillTemplate(t.duration, { time: spanText(labels, runDurationMs(run)) })}</span>
                </div>
            </div>
            {run.poolDown && <p role="status" data-testid="kg-run-pool-down" style={{ ...TYPE.meta, margin: 0 }}>{fillTemplate(t.poolDown, { reason: run.poolDown })}</p>}
            <Section title={r.detailTimeline}>
                <RunAxis run={run} labels={labels} />
            </Section>
            <RunTimeline run={run} labels={labels} />
            <RunPaceBars run={run} history={history} labels={labels} />
            <FailuresByReason run={run} labels={labels} onRetry={onRetry} canRetry={canRetry} />
            <RunSlowest run={run} labels={labels} />
            {rows.length > 0 && (
                <Section title={r.leftTitle}>
                    <ul data-testid="kg-run-left" style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 2, ...TYPE.body }}>{rows.map((x) => <li key={x}>{x}</li>)}</ul>
                </Section>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', borderTop: `1px solid ${cssVar('border')}`, paddingTop: 12 }}>
                <CopyDiagnostics labels={labels} text={diagnosticsText} />
                <button type="button" style={button} aria-expanded={steps} onClick={() => setSteps((v) => !v)}>{r.toggleSteps}</button>
            </div>
            {steps && <RunSteps key={run.id} run={run} labels={labels} />}
        </div>
    );
}
