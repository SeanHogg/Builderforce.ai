/**
 * The review action: a STATUS CHIP joined to the ACTION BUTTON (two buttons, one rounded border). It sits at the right end of the header row (`Toolbar`'s
 * `action` slot). The chip says what is true now (a dot, one line, a 2px underline of the progress while reviewing) and opens the Reviews panel on the tab that
 * explains it; the button is the next action and opens the panel on Review (a failed upload: Server). Where the action itself happens is the panel.
 *
 * Narrow (phone) containers: the chip shrinks to its dot (the words stay in its accessible name) and the button keeps its verb. A host that cannot review or
 * record runs gets the chip as a plain status and no button.
 */

import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { swatch } from '../styles';
import type { ReviewsTab } from './run/useReviewsTab';
import type { StripAction, SyncPill } from './syncPill';
import { STATUS_TONE } from './ui/statusTone';
import { useRetryUpload } from './run/useRetryUpload';
import { TYPE } from './ui/type';

export interface ReviewActionProps {
    labels: KnowledgeGraphLabels;
    narrow: boolean;
    pill: SyncPill;
    action: StripAction;
    /** Opens the Reviews panel on a tab. Absent ⇒ the host cannot review or record runs: the chip is a plain status and there is no button. */
    onOpen?: ((tab: ReviewsTab) => void) | undefined;
}

const HEIGHT = 'calc(var(--kg-control, 40px) - 6px)';

export function ReviewAction({ labels, narrow, pill, action, onOpen }: ReviewActionProps) {
    const retry = useRetryUpload();
    // A failed upload: when the source can retry, the button IS Retry upload (it retries at once; disabled while it runs); else it opens the Server tab.
    const retrying = pill.kind === 'uploadFailed' ? retry : undefined;
    const r = labels.surface.run.review;
    const label = retrying ? (retrying.running ? r.uploadRetrying : r.actionRetryUpload) : action.label;
    const disabled = action.disabled || !!retrying?.running;
    const busy = pill.kind === 'counting' || pill.kind === 'running' || pill.kind === 'stopping';
    const stateName = labels.surface.pillStates[pill.state];
    // Stopping is amber (the warn token), counting / reviewing / stopping spin; everything else is a plain dot in its state colour.
    const toneName = pill.kind === 'stopping' ? 'cycle' : STATUS_TONE[pill.state];
    const tone = cssVar(toneName);
    const dot = busy
        ? <span aria-hidden="true" data-testid="kg-chip-dot" data-spinner="true" data-tone={toneName} className="kg-spin" style={{ width: 10, height: 10, boxSizing: 'border-box', borderRadius: 999, flex: 'none', border: `2px solid ${tone}`, borderTopColor: 'transparent' }} />
        : <span aria-hidden="true" data-testid="kg-chip-dot" data-tone={toneName} style={{ ...swatch(tone), opacity: pill.state === 'syncing' ? 0.65 : 1 }} />;
    const text = narrow ? null : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{pill.text}</span>;
    const chipStyle = {
        ...TYPE.pill, position: 'relative' as const, display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: HEIGHT, minWidth: 0, padding: '0 12px', cursor: onOpen ? 'pointer' : 'default',
        border: `1px solid ${cssVar('border')}`, background: 'transparent', color: cssVar('text'), font: 'inherit', overflow: 'hidden',
    };
    return (
        <div role="group" aria-label={labels.surface.header.statusLabel} data-testid="kg-status-strip" style={{ display: 'inline-flex', minWidth: 0, flex: '0 1 auto' }}>
            {onOpen ? (
                <button
                    type="button" data-testid="kg-status-chip" data-state={pill.state} data-kind={pill.kind} aria-label={`${pill.text} ${stateName}`} title={pill.text}
                    onClick={() => onOpen(pill.tab)} style={{ ...chipStyle, borderRadius: '999px 0 0 999px', borderInlineEnd: 'none' }}
                >
                    {dot}{text}
                    {pill.frac !== undefined && (
                        <span aria-hidden="true" data-testid="kg-chip-progress" style={{ position: 'absolute', insetInlineStart: 0, bottom: 0, height: 2, width: `${Math.round(Math.min(1, pill.frac) * 100)}%`, background: cssVar('accent') }} />
                    )}
                </button>
            ) : (
                <span role="status" data-testid="kg-status-chip" data-state={pill.state} data-kind={pill.kind} aria-label={`${pill.text} ${stateName}`} title={pill.text} style={{ ...chipStyle, borderRadius: 999 }}>{dot}{text}</span>
            )}
            {onOpen && (
                <button
                    type="button" data-testid="kg-review-action" disabled={disabled} onClick={() => (retrying ? retrying.retry() : onOpen(action.tab))}
                    style={{
                        ...TYPE.pill, minHeight: HEIGHT, padding: '0 14px', borderRadius: '0 999px 999px 0', whiteSpace: 'nowrap', font: 'inherit', cursor: disabled ? 'default' : 'pointer',
                        border: `1px solid ${cssVar('accent')}`, background: cssVar('accent'), color: cssVar('onAccent'), opacity: disabled ? 0.6 : 1,
                    }}
                >
                    {label}
                </button>
            )}
        </div>
    );
}
