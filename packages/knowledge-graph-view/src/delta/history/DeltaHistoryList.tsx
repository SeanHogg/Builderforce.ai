/**
 * The run delta history (PRD 41 §C11.3): one row per run × repository, newest first — when, where
 * it ran, the headline verdict (word + icon + colour), new/resolved counts, the blast-radius band
 * and a blocked marker. Props only. With `onSelect` each row is a button that opens that run's
 * delta; without it the rows are plain text.
 */

import type { RunDeltaSummary } from '@builderforce/run-delta';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import { fillTemplate } from '../../template';
import type { RunDeltaLabels } from '../labels';
import { repoDisplayName } from '../repoName';
import { reasonTag, VerdictMark } from '../VerdictMark';
import { BandMark } from './BandMark';
import { defaultFormatNumber, defaultFormatTime, type DeltaFormatProps } from './formatters';
import type { RunDeltaHistoryLabels } from './historyLabels';
import { newestFirst, summaryKey } from './historyModel';

export interface DeltaHistoryListProps extends DeltaFormatProps {
    items: readonly RunDeltaSummary[];
    labels: RunDeltaLabels;
    historyLabels: RunDeltaHistoryLabels;
    /** Shows the repository on each row (a project that spans more than one). */
    showRepo?: boolean | undefined;
    onSelect?: ((item: RunDeltaSummary) => void) | undefined;
    /** The row whose delta is open, highlighted. */
    selectedKey?: string | undefined;
}

export function DeltaHistoryList(props: DeltaHistoryListProps) {
    const { items, labels, historyLabels, showRepo, onSelect, selectedKey } = props;
    const formatTime = props.formatTime ?? defaultFormatTime;
    const formatNumber = props.formatNumber ?? defaultFormatNumber;
    const rows = newestFirst(items);
    return (
        <ul data-run-delta-history style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', minWidth: 0 }}>
            {rows.map((item) => {
                const key = summaryKey(item);
                const time = formatTime(item.computedAt);
                const body = (
                    <>
                        <span style={{ display: 'grid', gap: 2, flex: '1 1 150px', minWidth: 0 }}>
                            <span style={{ ...TYPE.body, color: cssVar('text'), overflowWrap: 'anywhere' }}>{time}</span>
                            <span style={{ ...TYPE.meta, overflowWrap: 'anywhere' }}>
                                {historyLabels.surfaces[item.surface] ?? item.surface}
                                {showRepo ? ` · ${repoDisplayName(item.repoKey)}` : ''}
                            </span>
                        </span>
                        <VerdictMark verdict={item.headline} labels={labels} />
                        <span style={{ ...TYPE.meta, whiteSpace: 'nowrap' }}>
                            {fillTemplate(historyLabels.counts, { introduced: formatNumber(item.counts.introduced), resolved: formatNumber(item.counts.resolved) })}
                        </span>
                        <BandMark band={item.blastRadius.band} labels={labels} />
                        {item.blocking.length > 0 && (
                            <span data-blocked style={{ ...reasonTag, color: cssVar('sev5'), borderColor: cssVar('sev5') }}>{historyLabels.blocked}</span>
                        )}
                    </>
                );
                const rowStyle = {
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4, minWidth: 0, width: '100%',
                    boxSizing: 'border-box', padding: '8px 4px', borderTop: `1px solid ${cssVar('border')}`, textAlign: 'start',
                    background: key === selectedKey ? cssVar('accentSoft') : 'transparent', color: cssVar('text'),
                } as const;
                return (
                    <li key={key} data-run={item.runId} data-headline={item.headline}>
                        {onSelect ? (
                            <button
                                type="button"
                                aria-label={fillTemplate(historyLabels.openRun, { time })}
                                aria-current={key === selectedKey ? 'true' : undefined}
                                onClick={() => onSelect(item)}
                                style={{ ...rowStyle, border: 'none', borderTop: rowStyle.borderTop, font: 'inherit', cursor: 'pointer', minHeight: 40 }}
                            >
                                {body}
                            </button>
                        ) : (
                            <div style={rowStyle}>{body}</div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
