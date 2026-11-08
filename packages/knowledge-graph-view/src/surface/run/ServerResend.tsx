/**
 * "Review again to retry skipped files", under the files not stored. It starts the view's ONE review flow again for this root (the confirm still asks first); a host that
 * cannot review shows "Not available here", never a dead button. Nothing shows when no file was skipped.
 */

import type { KnowledgeGraphLabels } from '../../labels';
import { button, muted } from '../../styles';
import { Unavailable } from '../drawers/ui';

export function ServerResend({ labels, skippedCount, onResend }: { labels: KnowledgeGraphLabels; skippedCount: number; onResend?: (() => void) | undefined }) {
    const t = labels.surface.sync;
    if (skippedCount === 0) return null;
    return (
        <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
            {onResend
                ? <button type="button" data-testid="kg-sync-resend" style={button} onClick={onResend}>{t.resend}</button>
                : <Unavailable labels={labels} label={t.resend} testId="kg-sync-resend-unavailable" />}
            {onResend && <p style={{ ...muted, margin: 0 }}>{t.resendNote}</p>}
        </div>
    );
}
