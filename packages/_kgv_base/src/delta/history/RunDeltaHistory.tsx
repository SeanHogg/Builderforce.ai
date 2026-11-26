/**
 * A project's (or a repository's) run delta history and trend, as ONE section (PRD 41 §C11.3): the
 * trend charts first (insights by default), then the run list, with its loading, empty, error and
 * "show older" states. Props only — the host's container fetches the summaries and passes them in:
 * the web from `/api/projects/:id/run-deltas`, the VS Code webview from the host's local records.
 *
 * An error with no rows replaces the body; an error with rows already shown (a failed "show older")
 * keeps them and puts the message and its retry where the "show older" button was.
 */

import type { RunDeltaSummary } from '@builderforce/run-delta';
import { cssVar } from '../../scene/themeColors';
import { card, quietButton } from '../../styles';
import { TYPE } from '../../surface/ui/type';
import type { RunDeltaLabels } from '../labels';
import { DeltaHistoryList } from './DeltaHistoryList';
import { DeltaTrend } from './DeltaTrend';
import type { DeltaFormatProps } from './formatters';
import type { RunDeltaHistoryLabels } from './historyLabels';

export interface RunDeltaHistoryProps extends DeltaFormatProps {
    items: readonly RunDeltaSummary[];
    labels: RunDeltaLabels;
    historyLabels: RunDeltaHistoryLabels;
    loading?: boolean | undefined;
    /** A failed read: shown with a retry when `onRetry` is given. */
    error?: boolean | undefined;
    onRetry?: (() => void) | undefined;
    hasMore?: boolean | undefined;
    onLoadMore?: (() => void) | undefined;
    onSelect?: ((item: RunDeltaSummary) => void) | undefined;
    selectedKey?: string | undefined;
    /** The selected run's delta could not be opened (not "unavailable": a fault). */
    openError?: boolean | undefined;
    /** Render without the card frame (inside a host panel that already frames it). */
    bare?: boolean | undefined;
}

const heading = { ...TYPE.sectionHeading } as const;

function ErrorLine({ text, retry, onRetry }: { text: string; retry: string; onRetry?: (() => void) | undefined }) {
    return (
        <p role="alert" style={{ ...TYPE.body, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {text}
            {onRetry && <button type="button" onClick={onRetry} style={quietButton}>{retry}</button>}
        </p>
    );
}

export function RunDeltaHistory(props: RunDeltaHistoryProps) {
    const { items, labels, historyLabels, formatTime, formatNumber, loading, error, onRetry, hasMore, onLoadMore, onSelect, selectedKey, openError, bare } = props;
    const showRepo = new Set(items.map((i) => i.repoKey)).size > 1;
    const frame = bare ? {} : card;
    const errorLine = error ? <ErrorLine text={historyLabels.loadError} retry={historyLabels.retry} onRetry={onRetry} /> : null;
    return (
        <section
            aria-label={historyLabels.title}
            aria-busy={loading ? true : undefined}
            data-run-delta-history-section
            style={{ ...frame, display: 'grid', gap: 12, minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', color: cssVar('text') }}
        >
            <h3 style={{ ...TYPE.title, color: cssVar('text') }}>{historyLabels.title}</h3>
            {openError && <p role="alert" style={{ ...TYPE.body, margin: 0 }}>{historyLabels.openError}</p>}
            {items.length === 0 ? (
                errorLine ?? <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{loading ? historyLabels.loading : historyLabels.empty}</p>
            ) : (
                <>
                    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                        <h4 style={heading}>{historyLabels.trendHeading}</h4>
                        <DeltaTrend items={items} labels={labels} historyLabels={historyLabels} formatTime={formatTime} formatNumber={formatNumber} />
                    </div>
                    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                        <h4 style={heading}>{historyLabels.listHeading}</h4>
                        <DeltaHistoryList
                            items={items}
                            labels={labels}
                            historyLabels={historyLabels}
                            formatTime={formatTime}
                            formatNumber={formatNumber}
                            showRepo={showRepo}
                            onSelect={onSelect}
                            selectedKey={selectedKey}
                        />
                    </div>
                    {errorLine ?? (hasMore && onLoadMore && (
                        <button type="button" onClick={onLoadMore} disabled={loading} style={{ ...quietButton, justifySelf: 'start' }}>
                            {loading ? historyLabels.loading : historyLabels.loadMore}
                        </button>
                    ))}
                </>
            )}
        </section>
    );
}
