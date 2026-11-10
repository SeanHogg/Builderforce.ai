/**
 * The Physical view of the 4+1 camera: where the system runs. The deployable units (the root's systems, or the root
 * itself with its apps when it is one system), then the data stores and external services the lines end in — the
 * same termini the transit map draws (`groupTermini`), never a second reading.
 */

import { useMemo } from 'react';
import { fillTemplate } from '../../labels';
import { cmp } from '../../order';
import { cssVar } from '../../scene/themeColors';
import { card, chip } from '../../styles';
import { counted } from '../plural';
import type { SceneProps } from '../registry';
import { sourceFilesOf } from '../sourceFiles';
import { appOfNode, primarySystems, systemsOf } from '../systems';
import { groupTermini, terminusText } from '../transit/termini';
import { TYPE } from '../ui/type';

interface Unit { id: string; name: string; files: number; apps: string[] }

function unitsOf(graph: SceneProps['graph'], rootTitle: string): Unit[] {
    const systems = primarySystems(systemsOf(graph));
    if (systems.length > 0) return systems.map((s) => ({ id: s.path, name: s.name, files: s.files, apps: s.apps }));
    const files = sourceFilesOf(graph);
    if (!rootTitle || files.length === 0) return [];
    const apps = [...new Set(files.map(appOfNode).filter(Boolean))].sort(cmp);
    return [{ id: rootTitle, name: rootTitle, files: files.length, apps }];
}

const grid = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))' } as const;

export function PhysicalView({ graph, labels, rootTitle, surface }: SceneProps) {
    const s = labels.surface.fourPlusOne;
    const units = useMemo(() => unitsOf(graph, rootTitle), [graph, rootTitle]);
    const stores = useMemo(
        () => groupTermini(surface.lines.lines, surface.stations.byId, graph).filter((t) => t.kind !== 'end'),
        [surface.lines, surface.stations.byId, graph],
    );
    return (
        <div data-testid="kg-4plus1-physical" style={{ display: 'grid', gap: 14 }}>
            {units.length > 0 && (
                <section aria-label={s.unitsTitle} style={{ display: 'grid', gap: 6 }}>
                    <h4 style={TYPE.sectionHeading}>{s.unitsTitle}</h4>
                    <div style={grid}>
                        {units.map((u) => (
                            <div key={u.id} data-unit={u.id} style={{ ...card, display: 'grid', gap: 2, minWidth: 0 }}>
                                <span style={{ ...TYPE.monoTitle, color: cssVar('text'), overflowWrap: 'anywhere' }}>{u.name}</span>
                                <span style={TYPE.meta}>{counted(labels, 'file', u.files)}</span>
                                {u.apps.length > 0 && <span style={{ ...TYPE.meta, overflowWrap: 'anywhere' }}>{fillTemplate(s.unitApps, { apps: u.apps.join(', ') })}</span>}
                            </div>
                        ))}
                    </div>
                </section>
            )}
            <section aria-label={s.storesTitle} style={{ display: 'grid', gap: 6 }}>
                <h4 style={TYPE.sectionHeading}>{s.storesTitle}</h4>
                {stores.length === 0 ? <p style={{ ...TYPE.meta, margin: 0 }}>{s.storesEmpty}</p> : (
                    <div style={grid}>
                        {stores.map((t) => (
                            <button
                                key={t.stationId} type="button" data-store={t.stationId} aria-pressed={surface.station?.id === t.stationId}
                                onClick={() => surface.selectStation(t.stationId)}
                                style={{ ...chip(surface.station?.id === t.stationId), borderRadius: 10, borderStyle: 'dashed', display: 'grid', gap: 2, padding: '6px 12px', textAlign: 'start', whiteSpace: 'normal', minWidth: 0 }}
                            >
                                <span style={{ ...TYPE.monoName, color: cssVar('text'), overflowWrap: 'anywhere' }}>{surface.stations.byId.get(t.stationId)?.name ?? t.stationId}</span>
                                <span style={TYPE.meta}>{terminusText(t, labels)}</span>
                                <span style={TYPE.meta}>{counted(labels, 'line', t.lineIds.length)}</span>
                            </button>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
