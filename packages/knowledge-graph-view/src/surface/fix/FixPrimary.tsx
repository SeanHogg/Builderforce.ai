/**
 * The ONE primary action of the fix flow, whose label advances (Apply to branch → Run checks →
 * Mark resolved → Resolved ✓), with Undo and Before/After beside it, the reason a step failed, and
 * the permissions note. A step the host cannot do reads "Send to agent"; it is never a dead button.
 */

import type { KnowledgeGraphLabels } from '../../labels';
import { fillTemplate } from '../../labels';
import { counted } from '../plural';
import { cssVar } from '../../scene/themeColors';
import { button, muted, primaryButton } from '../../styles';
import { TYPE } from '../ui/type';
import { isResolved, type FixFlowState } from './fixFlow';
import type { FixFlow } from './useFixFlow';
import { FixBeforeAfter, type FixRevision } from './FixBeforeAfter';

/** The primary button's words for where the flow stands. Pure. */
export function primaryLabel(flow: FixFlow, labels: KnowledgeGraphLabels): string {
    const t = labels.surface.fix;
    const { state, primary } = flow;
    if (state.steps.checks === 'running' || state.steps.apply === 'running' || state.steps.resolve === 'running') return t.primary.running;
    if (isResolved(state)) return t.primary.resolved;
    if (!primary.step) return t.primary.sent;
    if (primary.how === 'prompt') return t.primary.prompt;
    if (primary.how === 'agent') return t.sendToAgent;
    return t.primary[primary.step];
}

const failedStep = (state: FixFlowState): string | undefined => state.errors.apply ?? state.errors.checks ?? state.errors.resolve ?? state.errors.undo;

export interface FixPrimaryProps {
    flow: FixFlow;
    labels: KnowledgeGraphLabels;
    hasComposer: boolean;
    revision?: FixRevision | undefined;
}

export function FixPrimary({ flow, labels, hasComposer, revision }: FixPrimaryProps) {
    const t = labels.surface.fix;
    const { state, primary, undo } = flow;
    const applied = state.applied;
    const error = failedStep(state);
    return (
        <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" data-act="primary" disabled={!primary.enabled} style={primary.enabled ? primaryButton : button} onClick={flow.runPrimary}>{primaryLabel(flow, labels)}</button>
                {state.steps.apply === 'done' && (
                    <button type="button" data-act="undo" disabled={!undo.enabled} title={undo.reason ? t.undoNoRecord : undefined} style={button} onClick={flow.runUndo}>{t.undo}</button>
                )}
                {revision && <FixBeforeAfter revision={revision} labels={labels} />}
            </div>
            {undo.reason && <p data-testid="kg-fix-undo-reason" style={{ ...muted, margin: 0 }}>{t.undoNoRecord}</p>}
            {!hasComposer && primary.how !== 'host' && <p style={{ ...muted, margin: 0 }}>{t.noComposer}</p>}
            {applied?.branch && <p role="status" style={{ ...muted, margin: 0 }}>{fillTemplate(t.appliedOn, { branch: applied.branch })}</p>}
            {applied?.branchError && <p role="status" data-testid="kg-fix-branch-error" style={{ ...muted, margin: 0 }}>{fillTemplate(t.branchError, { reason: applied.branchError })}</p>}
            {applied && applied.changed.length > 0 && (
                <div data-testid="kg-resolve-done" style={{ display: 'grid', gap: 2 }}>
                    <span style={muted}>{counted(labels, 'fileChanged', applied.changed.length)}</span>
                    <ul style={{ margin: 0, paddingInlineStart: 18, ...TYPE.body }}>{applied.changed.map((p) => <li key={p} style={{ overflowWrap: 'anywhere' }}>{p}</li>)}</ul>
                </div>
            )}
            {error && <p role="alert" data-testid="kg-fix-error" style={{ margin: 0, ...TYPE.body, color: cssVar('violation'), whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error}</p>}
            <span style={{ ...TYPE.meta, lineHeight: '16px' }}>{t.permNote}</span>
        </div>
    );
}
