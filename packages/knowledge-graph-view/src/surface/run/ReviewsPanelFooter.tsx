/**
 * The Reviews panel's pinned footer (it sits OUTSIDE the panel's scroller, so it never scrolls, and it is the same on every tab): a one-line note on the left and ONE
 * primary button on the right that follows the state - Start review (nothing planned: it counts, then starts), Start review (the plan), Stop (red outline), "Stopping…"
 * (disabled) then Force stop once the stop has waited `STUCK_AFTER_MS`, Resume, Review again. The Server tab adds Copy diagnostics beside it.
 */

import type { ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { primaryButton } from '../../styles';
import type { ReviewState } from '../../useReviewRun';
import { counted } from '../plural';
import { TYPE } from '../ui/type';
import { useStuckSince } from './ReviewStopping';
import { spanText } from './runModel';

export interface ReviewsPanelFooterProps {
    labels: KnowledgeGraphLabels;
    state: ReviewState;
    /** A review is running (this view's, or one the host reports on its own). */
    running: boolean;
    /** When Stop was pressed (epoch ms), for this view's review or a host-run one; undefined ⇒ not stopping. */
    stoppingSince: number | undefined;
    /** After a stop: the files still to review and the time they take at the run's pace. */
    left?: { files: number; etaMs?: number | undefined } | undefined;
    /** Beside the button (the Server tab: Copy diagnostics). */
    extra?: ReactNode;
    /** Nothing is planned: count the files and start, in one press. */
    onCountAndStart(): void;
    onStart(): void;
    onStop(): void;
    onForceStop(): void;
    onResume(): void;
    onAgain(): void;
}

export function ReviewsPanelFooter({ labels, state, running, stoppingSince, left, extra, onCountAndStart, onStart, onStop, onForceStop, onResume, onAgain }: ReviewsPanelFooterProps) {
    const r = labels.surface.run.review;
    const stuck = useStuckSince(stoppingSince);
    const danger = { ...primaryButton, background: 'transparent', color: cssVar('violation'), borderColor: cssVar('violation') };
    const go = (label: string, onClick: () => void, style = primaryButton) => <button type="button" data-testid="kg-footer-action" style={style} onClick={onClick}>{label}</button>;
    let note: string = r.noteIdle;
    let button: ReactNode;
    if (stoppingSince !== undefined) {
        note = r.noteRunning;
        button = stuck ? go(r.forceStop, onForceStop, danger)
            : <button type="button" data-testid="kg-footer-action" style={{ ...danger, opacity: 0.6 }} disabled>{r.stoppingTitle}</button>;
    } else if (running) {
        note = r.noteRunning;
        button = go(labels.reviewStop, onStop, danger);
    } else if (state.status === 'aborted') {
        if (left) note = left.etaMs !== undefined && left.etaMs > 0 ? fillTemplate(r.noteLeft, { files: counted(labels, 'file', left.files), eta: `~${spanText(labels, left.etaMs)}` }) : fillTemplate(r.noteLeftNoEta, { files: counted(labels, 'file', left.files) });
        button = go(left ? fillTemplate(r.resume, { left: left.files }) : r.actionResume, onResume);
    } else if (state.status === 'confirm') {
        button = go(r.actionStart, onStart);
    } else if (state.status === 'planning') {
        button = <button type="button" data-testid="kg-footer-action" style={{ ...primaryButton, opacity: 0.6 }} disabled>{r.actionStart}</button>;
    } else if (state.status === 'idle' || state.status === 'cancelled') {
        button = go(r.actionStart, onCountAndStart);
    } else {
        button = go(r.actionAgain, onAgain);
    }
    return (
        <footer
            data-testid="kg-reviews-footer"
            style={{ flex: 'none', padding: '10px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: cssVar('bg'), borderTop: `1px solid ${cssVar('border')}` }}
        >
            <p data-testid="kg-footer-note" style={{ ...TYPE.meta, margin: 0, flex: '1 1 160px', minWidth: 0 }}>{note}</p>
            {extra}
            {button}
        </footer>
    );
}
