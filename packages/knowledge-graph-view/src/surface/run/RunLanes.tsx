/**
 * The Run panel's lanes (PRD 41 A8): one row per worker of the phase being watched, with the file it
 * is on and how many it has finished. This is the "watch it execute" view: it re-renders with every
 * run record the host posts. Rows stack on a narrow panel (the name and path wrap, never scroll sideways).
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import type { StoredReviewRun } from '../../types';
import { Section } from '../drawers/ui';
import { counted } from '../plural';
import { stationName } from '../stationName';
import { TYPE } from '../ui/type';
import { activePhase, lanesOf } from './runModel';

export function RunLanes({ run, labels }: { run: StoredReviewRun; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.run;
    const phase = activePhase(run);
    const lanes = lanesOf(run, phase);
    // A finished run keeps its last lanes for the record; only a live one says nobody is busy.
    if (lanes.length === 0 && run.endedAt !== undefined) return null;
    return (
        <Section title={t.lanesTitle}>
            {lanes.length === 0 ? <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.lanesNone}</p> : (
                <ul data-testid="kg-run-lanes" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {lanes.map((lane) => (
                        <li
                            key={`${lane.phase}-${lane.id}`} data-lane={lane.id}
                            style={{ display: 'flex', gap: '2px 10px', alignItems: 'baseline', flexWrap: 'wrap', borderBottom: `1px solid ${cssVar('border')}`, paddingBottom: 4 }}
                        >
                            <span style={{ ...TYPE.subtitle, flex: 'none' }}>{fillTemplate(t.laneName, { id: lane.id + 1 })}</span>
                            <span title={lane.path} style={{ ...TYPE.monoName, flex: '1 1 140px', minWidth: 0, overflowWrap: 'anywhere' }}>
                                {lane.path ? stationName(lane.path) : t.laneIdle}
                            </span>
                            <span style={TYPE.meta}>{counted(labels, 'file', lane.done)}</span>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}
