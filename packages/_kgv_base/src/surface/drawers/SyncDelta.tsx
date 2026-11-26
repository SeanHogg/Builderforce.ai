/**
 * The Sync drawer's delta feed: the commits since the last review, newest first, each marked
 * pending (not in the picture yet) or applied, with who made it when the host knows. Read from
 * the root's ONE history read (`PanelProps.history`); a source that keeps no history says so,
 * and a read still on the way says "loading", never "no commits".
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { counted } from '../plural';
import { card, muted } from '../../styles';
import { TYPE } from '../ui/type';
import type { Commit } from '../../types';
import { relativeTime } from '../syncPill';
import { deltaFeed, pendingCount } from './syncDeltaModel';
import { Section, StateLabel, Unavailable } from './ui';

const SHA = 7;

export function SyncDelta({ commits, hasHistory, loading = false, lastReviewedAt, labels }: {
    commits: readonly Commit[];
    hasHistory: boolean;
    loading?: boolean | undefined;
    lastReviewedAt?: string | undefined;
    labels: KnowledgeGraphLabels;
}) {
    const t = labels.surface.sync;
    const rows = deltaFeed(commits, lastReviewedAt);
    return (
        <Section title={t.deltaTitle}>
            {!hasHistory ? <Unavailable labels={labels} testId="kg-sync-delta-unavailable" />
                : loading ? <p role="status" data-testid="kg-sync-delta-loading" style={{ ...muted, margin: 0 }}>{t.deltaLoading}</p>
                    : rows.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.deltaEmpty}</p> : (
                        <>
                            <p role="status" style={{ ...muted, margin: 0 }}>{fillTemplate(t.deltaSummary, { count: pendingCount(rows) })}</p>
                            <ul data-testid="kg-sync-delta" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                                {rows.map((r) => (
                                    <li key={r.sha} data-sha={r.sha} data-state={r.state} style={{ ...card, display: 'flex', gap: 8, alignItems: 'flex-start', padding: 8 }}>
                                        <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                                            <strong style={{ ...TYPE.subtitle, overflowWrap: 'anywhere' }}>{r.title}</strong>
                                            <span style={{ ...TYPE.monoMeta, fontSize: TYPE.meta.fontSize, overflowWrap: 'anywhere' }}>
                                                {counted(labels, r.author ? 'commitRowAuthor' : 'commitRow', r.files, { sha: r.sha.slice(0, SHA), author: r.author ?? '', when: relativeTime(r.at) })}
                                            </span>
                                        </span>
                                        <StateLabel tone={r.state === 'pending' ? 'cycle' : 'agrees'}>{r.state === 'pending' ? t.deltaPending : t.deltaApplied}</StateLabel>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
        </Section>
    );
}
