/**
 * The review status, ONE ghost button at the right of the header (design prototype `#reviewBtn`): a dot in the state's colour (a spinner while counting, reviewing
 * or stopping), the status words, and a 2px underline of the progress while reviewing. It says what is true now and opens the Review tab of the drawer on the
 * tab that explains it — where every action (Review again, Resume, Stop, Retry upload) lives. A host that cannot review or record runs gets a plain status.
 *
 * Narrow (the wrapped header) containers: the words stay in its accessible name and the button keeps its dot.
 */

import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { swatch } from '../styles';
import type { ReviewsTab } from './run/useReviewsTab';
import type { SyncPill } from './syncPill';
import { ghostButtonStyle } from './ui';
import { STATUS_TONE } from './ui/statusTone';

export interface ReviewActionProps {
    labels: KnowledgeGraphLabels;
    narrow: boolean;
    pill: SyncPill;
    /** Opens the Reviews panel on a tab. Absent ⇒ the host cannot review or record runs: the status is plain text and not a button. */
    onOpen?: ((tab: ReviewsTab) => void) | undefined;
}

export function ReviewAction({ labels, narrow, pill, onOpen }: ReviewActionProps) {
    const busy = pill.kind === 'counting' || pill.kind === 'running' || pill.kind === 'stopping';
    const stateName = labels.surface.pillStates[pill.state];
    // Stopping is amber (the warn token), counting / reviewing / stopping spin; everything else is a plain dot in its state colour.
    const toneName = pill.kind === 'stopping' ? 'cycle' : STATUS_TONE[pill.state];
    const tone = cssVar(toneName);
    const dot = busy
        ? <span aria-hidden="true" data-testid="kg-chip-dot" data-spinner="true" data-tone={toneName} className="kg-spin" style={{ width: 10, height: 10, boxSizing: 'border-box', borderRadius: 999, flex: 'none', border: `2px solid ${tone}`, borderTopColor: 'transparent' }} />
        : <span aria-hidden="true" data-testid="kg-chip-dot" data-tone={toneName} style={{ ...swatch(tone), opacity: pill.state === 'syncing' ? 0.65 : 1 }} />;
    const text = narrow ? null : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{pill.text}</span>;
    const common = { 'data-testid': 'kg-status-chip', 'data-state': pill.state, 'data-kind': pill.kind, 'aria-label': `${pill.text} ${stateName}`, title: pill.text } as const;
    const style = { ...ghostButtonStyle(false, false), position: 'relative' as const, minWidth: 0, overflow: 'hidden', cursor: onOpen ? 'pointer' : 'default' };
    return (
        <div role="group" aria-label={labels.surface.header.statusLabel} data-testid="kg-status-strip" style={{ display: 'inline-flex', minWidth: 0, flex: '0 1 auto' }}>
            {onOpen ? (
                <button type="button" {...common} onClick={() => onOpen(pill.tab)} style={style}>
                    {dot}{text}
                    {pill.frac !== undefined && (
                        <span aria-hidden="true" data-testid="kg-chip-progress" style={{ position: 'absolute', insetInlineStart: 0, bottom: 0, height: 2, width: `${Math.round(Math.min(1, pill.frac) * 100)}%`, background: cssVar('accent') }} />
                    )}
                </button>
            ) : (
                <span role="status" {...common} style={style}>{dot}{text}</span>
            )}
        </div>
    );
}
