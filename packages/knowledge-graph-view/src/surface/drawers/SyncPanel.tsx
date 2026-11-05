/**
 * The Sync drawer: where the reviewed root stands against the server. The six pipeline steps
 * with their state, local-against-server bars for files, edges and docs, the skipped files
 * with their reasons (nothing is dropped without a trace), the data sources and whether each
 * was collected, estimated or is not set up, and the folders the walk never reads. *Copy
 * diagnostics* reuses the view's own diagnostics text. Nothing renders when the source cannot
 * report its status.
 */

import { useEffect, useState } from 'react';
import { CopiedNote, CopyFallback, useCopyText } from '../../copyText';
import { fillTemplate } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { button, card, muted } from '../../styles';
import type { SyncStatus } from '../../types';
import type { PanelProps } from '../registry';
import { SkippedItems } from '../../SkippedList';
import { COUNTS, pipelineSteps, serverShare, type StepState } from './syncModel';
import { Bar, Section } from './ui';

const STATE_TONE: Record<StepState, ThemeTone> = { ok: 'agrees', pending: 'muted', attention: 'cycle' };
const SOURCE_TONE = { collected: 'agrees', estimated: 'cycle', absent: 'muted' } as const satisfies Record<string, ThemeTone>;
const EXCLUDED = ['nested', 'worktrees', 'local', 'vendored'] as const;

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; status: SyncStatus };

export function SyncPanel({ labels, source, rootId, diagnosticsText }: PanelProps) {
    const t = labels.surface.sync, s = labels.surface;
    const [load, setLoad] = useState<Load>({ state: 'loading' });
    const copier = useCopyText();
    const read = source?.syncStatus;
    useEffect(() => {
        if (!read || !rootId) return;
        let live = true;
        setLoad({ state: 'loading' });
        read.call(source, rootId).then(
            (status) => { if (live) setLoad({ state: 'ready', status }); },
            () => { if (live) setLoad({ state: 'failed' }); },
        );
        return () => { live = false; };
    }, [read, source, rootId]);
    if (!read) return null;
    if (load.state === 'loading') return <p role="status" style={{ ...muted, margin: 0 }}>{t.loading}</p>;
    if (load.state === 'failed') return <p role="alert" style={{ margin: 0 }}>{t.failed}</p>;

    const { status } = load;
    const diagnostics = diagnosticsText?.();
    return (
        <div data-testid="kg-sync" style={{ display: 'grid', gap: 16 }}>
            <Section title={t.pipelineTitle}>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {pipelineSteps(status).map((step) => (
                        <li key={step.id} data-step={step.id} data-state={step.state} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 999, background: cssVar(STATE_TONE[step.state]), flex: 'none' }} />
                            <span style={{ flex: 1 }}>{s.syncSteps[step.id]}</span>
                            <span style={{ ...muted, color: cssVar(STATE_TONE[step.state]) }}>{s.syncStates[step.state]}</span>
                        </li>
                    ))}
                </ol>
            </Section>
            <Section title={`${t.localTitle} / ${t.serverTitle}`}>
                {!status.server && <p style={{ ...muted, margin: 0 }}>{t.notUploaded}</p>}
                {COUNTS.map((k) => {
                    const local = status.local[k], server = status.server?.[k];
                    // A count the host did not measure (the edges of a linked folder) is said so, with no bar to mislead.
                    if (local === undefined) {
                        return (
                            <div key={k} data-count={k} data-measured="false" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                <strong>{t[k]}</strong>
                                <span style={muted}>{t.edgesNotMeasured}</span>
                            </div>
                        );
                    }
                    return (
                        <div key={k} data-count={k} style={{ display: 'grid', gap: 4 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                <strong>{t[k]}</strong>
                                <span style={muted}>{local}{server !== undefined ? ` / ${server}` : ''}</span>
                            </div>
                            <Bar
                                frac={serverShare(local, server)} tone={server === local ? 'agrees' : 'cycle'}
                                label={fillTemplate(t.barAria, { label: t[k], local, server: server === undefined ? t.notUploaded : server })}
                            />
                        </div>
                    );
                })}
                {(status.local.truncated || status.server?.truncated) && <p role="status" data-testid="kg-sync-truncated" style={{ ...muted, margin: 0 }}>{t.truncatedNote}</p>}
            </Section>
            <Section title={t.skippedTitle}>
                {status.skipped === undefined ? <p data-testid="kg-sync-skipped-unknown" style={{ ...muted, margin: 0 }}>{t.skippedUnknown}</p>
                    : status.skipped.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.skippedNone}</p>
                        : <SkippedItems items={status.skipped} labels={labels} testId="kg-sync-skipped" />}
            </Section>
            <Section title={t.sourcesTitle}>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {status.sources.map((src) => (
                        <li key={src.id} data-source={src.id} data-state={src.state} style={{ display: 'grid', gap: 2 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <strong style={{ flex: 1, fontSize: 13 }}>{s.syncSources[src.id]}</strong>
                                <span style={{ fontSize: 11, fontWeight: 700, color: cssVar(SOURCE_TONE[src.state]) }}>{s.sourceStates[src.state]}</span>
                            </div>
                            {src.note && <span style={muted}>{src.note}</span>}
                        </li>
                    ))}
                </ul>
            </Section>
            <Section title={t.excludedTitle}>
                <p style={{ ...muted, margin: 0 }}>{t.excludedNote}</p>
                <ul style={{ ...card, margin: 0, listStyle: 'none', display: 'grid', gap: 2, fontSize: 12 }}>
                    {EXCLUDED.map((k) => <li key={k}>{s.syncExcluded[k]}</li>)}
                </ul>
            </Section>
            {diagnostics !== undefined && (
                <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button type="button" style={button} onClick={() => void copier.copy(diagnostics)}>{labels.copyDiagnostics}</button>
                        <CopiedNote status={copier.status} labels={labels} />
                    </div>
                    <CopyFallback status={copier.status} text={diagnostics} label={labels.copyDiagnostics} labels={labels} />
                </div>
            )}
        </div>
    );
}
