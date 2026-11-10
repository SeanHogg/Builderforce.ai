/**
 * The Scenarios ("+1") view of the 4+1 camera: the use cases that tie the four views together. Each is a line of the
 * transit map — a path that starts at an entry point and runs down the layers to where it ends — so the scenarios
 * are the line model the other cameras read, never a second tracing. Selecting one selects its line.
 */

import { fillTemplate } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { chip } from '../../styles';
import { counted } from '../plural';
import type { SceneProps } from '../registry';
import { TYPE } from '../ui/type';

export function ScenariosView({ labels, surface }: SceneProps) {
    const s = labels.surface.fourPlusOne;
    const { lines } = surface.lines;
    const nameOf = (id: string | undefined): string => (id ? surface.stations.byId.get(id)?.name ?? id : '');
    return (
        <section data-testid="kg-4plus1-scenarios" aria-label={s.scenariosTitle} style={{ display: 'grid', gap: 6 }}>
            <h4 style={TYPE.sectionHeading}>{s.scenariosTitle}</h4>
            {lines.length === 0 ? <p style={{ ...TYPE.meta, margin: 0 }}>{s.scenariosEmpty}</p> : (
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))' }}>
                    {lines.map((line) => {
                        const on = surface.line?.id === line.id;
                        return (
                            <button
                                key={line.id} type="button" data-scenario={line.id} aria-pressed={on} onClick={() => surface.selectLine(line.id)}
                                style={{ ...chip(on), borderRadius: 10, display: 'grid', gap: 2, padding: '6px 12px', textAlign: 'start', whiteSpace: 'normal', minWidth: 0 }}
                            >
                                <span style={{ ...TYPE.subtitle, color: cssVar('text'), overflowWrap: 'anywhere' }}>{line.name}</span>
                                <span style={{ ...TYPE.monoMeta, overflowWrap: 'anywhere' }}>
                                    {fillTemplate(s.scenarioRoute, { from: nameOf(line.stops[0]), to: nameOf(line.terminus.stationId) })}
                                </span>
                                <span style={TYPE.meta}>{counted(labels, 'stop', line.stops.length)}</span>
                                <span style={TYPE.meta}>{labels.surface.terminus[line.terminus.kind]}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
