/**
 * The System camera (PRD 38, Option B+): the stations as N tiers, one horizontal row per layer
 * (label, equal-width cards, the sentence that reaches the next tier), then DATA AND EXTERNAL
 * as dashed store cards. The rows, cards and store cards live in `system/`; this component
 * reads the surface, builds the layout once and wires selection and the "+N more" jump to the
 * List. Colours come from the overlay bindings, like every camera.
 */

import { useCallback, useMemo } from 'react';
import { fillTemplate } from '../labels';
import { cssVar } from '../scene/themeColors';
import { muted } from '../styles';
import type { SceneProps } from './registry';
import type { Station } from './stations';
import { findingKinds } from './tiers';
import { NotLayeredRow, StoreRow } from './system/StoreRow';
import { buildSystemGroups } from './system/systemGroups';
import { buildSystemLayout, kindTones, listRefs, type SystemLayout } from './system/systemModel';
import { TYPE } from './ui/type';
import { TierRowView } from './system/TierRowView';

export function SystemTiers({ graph, labels, surface, onShow, onCamera }: SceneProps) {
    const s = labels.surface;
    const { stations, overlay, lines, lit } = surface;
    const layout = useMemo(() => buildSystemLayout(stations, lines, graph), [stations, lines, graph]);
    // A root of several systems shows one tier group per system (PRD 41 A9); one system is the single group it always was.
    const groups = useMemo(() => buildSystemGroups(stations, lines, graph), [stations, lines, graph]);
    const byFinding = useMemo(() => new Map(graph.findings.map((f) => [f.id, f] as const)), [graph.findings]);
    const tones = useMemo(() => kindTones(graph.findings.map((f) => f.kind)), [graph.findings]);
    const layerName = (layer: string) => s.layers[layer as keyof typeof s.layers] ?? s.layers.other;
    const dim = (id: string) => lit !== null && !lit.has(id);
    const foundOf = useCallback((id: string) => { const st = stations.byId.get(id); return st ? findingKinds(st, byFinding) : []; }, [stations, byFinding]);
    // A card, or the "+N more" card, that hands a set of stations to the List: focus their files, then switch camera.
    const openList = (set: readonly Station[]) => { onShow(listRefs(set)); onCamera?.('list'); };
    if (stations.stations.length === 0) return <p style={{ ...muted, padding: 12 }}>{s.system.empty}</p>;
    const selectedId = surface.station?.id ?? null;

    const rows = (l: SystemLayout) => (
        <>
            {l.tiers.map((tier) => (
                <TierRowView
                    key={tier.layer} tier={tier} name={layerName(tier.layer)} arrow={s.systemArrows[tier.layer as keyof typeof s.systemArrows]}
                    labels={labels} overlay={overlay} tones={tones} foundOf={foundOf} selectedId={selectedId} dim={dim}
                    onSelect={surface.selectStation} onMore={(t) => openList(t.stations)}
                />
            ))}
            <StoreRow stores={l.stores} byId={stations.byId} labels={labels} selectedId={selectedId} dim={dim} onSelect={surface.selectStation} />
            <NotLayeredRow stations={l.notLayered} labels={labels} onOpen={openList} />
        </>
    );

    return (
        <div data-testid="kg-system" role="group" aria-label={labels.regionLabel} style={{ display: 'flex', flexDirection: 'column', gap: groups.length > 0 ? 16 : 4, minHeight: '100%', boxSizing: 'border-box', padding: 12 }}>
            {groups.length === 0 ? rows(layout) : groups.map((g) => (
                <section key={g.system} data-system={g.system} aria-label={fillTemplate(s.systems.groupAria, { name: g.name || s.systems.loose })} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <h3 style={{ ...TYPE.sectionHeading, margin: 0, color: cssVar('text'), overflowWrap: 'anywhere' }}>{g.name || s.systems.loose}</h3>
                    {rows(g.layout)}
                </section>
            ))}
        </div>
    );
}
