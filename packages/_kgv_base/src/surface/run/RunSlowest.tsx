/**
 * The Run panel's slowest steps (PRD 41 A10): the five longest steps of the run's ring, longest first, each with its
 * file, phase, time, the reason it gave and, when the host timed them, how the time split between read, lookup and
 * pool, so a stall names itself.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import type { StoredReviewRun } from '../../types';
import { Section } from '../drawers/ui';
import { stationName } from '../stationName';
import { TYPE } from '../ui/type';
import { durationText, reasonKind, slowestOf } from './runModel';

export function RunSlowest({ run, labels }: { run: StoredReviewRun; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.run;
    const slow = slowestOf(run);
    return (
        <Section title={t.slowestTitle}>
            {slow.length === 0 ? (
                <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.slowestNone}</p>
            ) : (
                <ol data-testid="kg-run-slowest" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {slow.map((s, i) => {
                        const parts = [
                            s.parts?.readMs !== undefined && fillTemplate(t.partRead, { time: durationText(labels, s.parts.readMs) }),
                            s.parts?.lookupMs !== undefined && fillTemplate(t.partLookup, { time: durationText(labels, s.parts.lookupMs) }),
                            s.parts?.poolMs !== undefined && fillTemplate(t.partPool, { time: durationText(labels, s.parts.poolMs) }),
                        ].filter((x): x is string => !!x);
                        return (
                            <li key={`${i}-${s.path}-${s.phase}`} data-phase={s.phase} style={{ display: 'grid', gap: 2 }}>
                                <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                    <span title={s.path} style={{ ...TYPE.monoName, flex: '1 1 120px', minWidth: 0, overflowWrap: 'anywhere' }}>{stationName(s.path)}</span>
                                    <span style={TYPE.meta}>{labels.phases[s.phase]}</span>
                                    <span style={TYPE.monoMeta}>{durationText(labels, s.ms)}</span>
                                </span>
                                {(s.reason || parts.length > 0) && (
                                    <span style={{ ...TYPE.meta, display: 'flex', gap: 10, flexWrap: 'wrap', overflowWrap: 'anywhere' }}>
                                        {s.reason && <span title={s.reason}>{t.reasons[reasonKind(s.reason)]}</span>}
                                        {parts.length > 0 && <span data-testid="kg-run-slowest-parts">{parts.join(' · ')}</span>}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}
        </Section>
    );
}
