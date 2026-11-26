/**
 * The folders the review never read, by their real names from the review's record (the
 * nested checkouts, `.worktrees`, `*.local` and vendored `_*_src` folders it found). No record
 * is "unknown", which is not "none".
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { card, muted } from '../../styles';
import { TYPE } from '../ui/type';
import type { ExcludedFolder } from './syncDeltaModel';
import { Section } from './ui';

export function SyncExcluded({ folders, recorded, labels }: { folders: readonly ExcludedFolder[]; recorded: boolean; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.sync;
    return (
        <Section title={t.excludedTitle}>
            <p style={{ ...muted, margin: 0 }}>{t.excludedNote}</p>
            {!recorded ? <p data-testid="kg-sync-excluded-unknown" style={{ ...muted, margin: 0 }}>{t.skippedUnknown}</p>
                : folders.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.excludedNone}</p> : (
                    <ul data-testid="kg-sync-excluded" style={{ ...card, margin: 0, listStyle: 'none', display: 'grid', gap: 4, ...TYPE.body }}>
                        {folders.map((f) => (
                            <li key={f.path} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ ...TYPE.mono, overflowWrap: 'anywhere' }}>{fillTemplate(t.excludedFolder, { path: f.path })}</span>
                                <span style={muted}>{labels.surface.syncExcluded[f.kind]}</span>
                            </li>
                        ))}
                    </ul>
                )}
        </Section>
    );
}
