/**
 * The Sync drawer's data-source rows: each source with its state and, where it is not
 * collected, the one action that sets it up. An action goes to the composer (the agent does
 * the work) or opens a drawer; a host that cannot do it shows "Not available here", never a
 * dead button.
 */

import type { KnowledgeGraphLabels } from '../../labels';
import type { ThemeTone } from '../../scene/themeColors';
import { button, muted } from '../../styles';
import { TYPE } from '../ui/type';
import type { ComposeFn, SyncStatus } from '../../types';
import { sourceAction, sourceNote } from './syncDeltaModel';
import { Section, StateLabel, Unavailable } from './ui';

const SOURCE_TONE = { collected: 'agrees', estimated: 'cycle', absent: 'muted' } as const satisfies Record<string, ThemeTone>;

export function SyncSources({ sources, labels, onCompose, onOpenPanel }: {
    sources: SyncStatus['sources'];
    labels: KnowledgeGraphLabels;
    onCompose?: ComposeFn | undefined;
    onOpenPanel(id: string): void;
}) {
    const s = labels.surface, t = s.sync;
    return (
        <Section title={t.sourcesTitle}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {sources.map((src) => {
                    const act = sourceAction(src);
                    const note = sourceNote(src, t);
                    const can = act.kind === 'panel' || (act.kind === 'compose' && !!onCompose);
                    return (
                        <li key={src.id} data-source={src.id} data-state={src.state} style={{ display: 'grid', gap: 2 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <strong style={{ flex: 1, minWidth: 100, ...TYPE.subtitle }}>{s.syncSources[src.id]}</strong>
                                <StateLabel tone={SOURCE_TONE[src.state]}>{s.sourceStates[src.state]}</StateLabel>
                                {act.kind !== 'none' && (can ? (
                                    <button
                                        type="button" data-action={act.label} style={{ ...button, minHeight: 32, padding: '0 10px' }}
                                        onClick={() => (act.kind === 'panel' ? onOpenPanel(act.panel) : onCompose?.(t[act.request], { send: true }))}
                                    >
                                        {t[act.label]}
                                    </button>
                                ) : <Unavailable labels={labels} testId="kg-source-unavailable" />)}
                            </div>
                            {note && <span style={muted}>{note}</span>}
                        </li>
                    );
                })}
            </ul>
        </Section>
    );
}
