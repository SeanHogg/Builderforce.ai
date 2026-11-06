/**
 * The Sync drawer's local-against-server bars for files, edges and docs, each with a note in
 * words (the server has all of it, or how many are not there yet, and how many of the files were
 * too large to store). A count the host did not measure says so, with no bar to mislead.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { muted } from '../../styles';
import type { SyncStatus } from '../../types';
import { COUNTS, parityNote, serverShare, syncGap } from './syncModel';
import { Bar, Section } from './ui';

export function SyncParity({ status, labels }: { status: SyncStatus; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.sync;
    const gap = syncGap(status);
    return (
        <Section title={fillTemplate(t.parityTitle, { local: t.localTitle, server: t.serverTitle })}>
            {!status.server && <p style={{ ...muted, margin: 0 }}>{t.notUploaded}</p>}
            {COUNTS.map((k) => {
                const local = status.local[k], server = status.server?.[k];
                if (local === undefined) {
                    return (
                        <div key={k} data-count={k} data-measured="false" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                            <strong>{t[k]}</strong>
                            <span style={muted}>{t.edgesNotMeasured}</span>
                        </div>
                    );
                }
                const note = parityNote(local, server);
                return (
                    <div key={k} data-count={k} style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                            <strong>{t[k]}</strong>
                            <span style={muted}>{server === undefined ? local : fillTemplate(t.countPair, { local, server })}</span>
                        </div>
                        <Bar
                            frac={serverShare(local, server)} tone={server === local ? 'agrees' : 'cycle'}
                            label={fillTemplate(t.barAria, { label: t[k], local, server: server === undefined ? t.notUploaded : server })}
                        />
                        {note && (
                            <span data-testid={`kg-parity-note-${k}`} style={muted}>
                                {note.kind === 'all' ? t.parityAll : fillTemplate(t.parityMissing, { count: note.count })}
                                {k === 'files' && gap.tooLarge > 0 ? ` ${fillTemplate(t.parityTooLarge, { count: Math.min(gap.tooLarge, gap.missing) })}` : ''}
                            </span>
                        )}
                    </div>
                );
            })}
            {(status.local.truncated || status.server?.truncated) && <p role="status" data-testid="kg-sync-truncated" style={{ ...muted, margin: 0 }}>{t.truncatedNote}</p>}
        </Section>
    );
}
