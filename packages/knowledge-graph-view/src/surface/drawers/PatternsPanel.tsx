/**
 * The Patterns drawer: a family-by-layer matrix from the `patterns` badge, the families as a list
 * (marked heuristic, because they are read from names and imports), and the anti-patterns GROUPED
 * (one card per kind and layer pair, not one per link) with multiselect, *Why*, *Show in Tower*
 * and a *Preview* before anything is applied. Choosing a family lights its stations through the
 * "What patterns are here?" question; clicking an Anti-pattern cell narrows the list to a layer.
 */

import { useMemo, useState } from 'react';
import { nodeIndex } from '../../graphModel';
import { counted } from '../plural';
import { muted } from '../../styles';
import { TYPE } from '../ui/type';
import { ProvenanceBadge } from '../ui';
import { useSelection } from '../../useSelection';
import { stationOfRef } from '../stations';
import { useShowInTower } from '../useShowInTower';
import type { PanelProps } from '../registry';
import { groupAntiPatterns } from './antiPatternGroups';
import { AntiPatternList } from './AntiPatternList';
import { AntiPatternPreview } from './AntiPatternPreview';
import { PatternMatrixTable } from './PatternMatrixTable';
import { PatternsFooter } from './PatternsFooter';
import { patternMatrix } from './patternsModel';
import { NotSetUp, Section } from './ui';

export function PatternsPanel({ graph, labels, surface, source, onShow, onCamera, cameras, onCompose, onChanged }: PanelProps) {
    const s = labels.surface, t = s.patterns;
    const [active, setActive] = useState<{ family: string; stations: number } | null>(null);
    const [layer, setLayer] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const selection = useSelection();
    const matrix = useMemo(() => patternMatrix(graph, surface.stations), [graph, surface.stations]);
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const groups = useMemo(() => groupAntiPatterns(graph.findings, { layer, model: surface.stations }), [graph.findings, layer, surface.stations]);
    const chosen = useMemo(() => groups.filter((g) => selection.selected.has(g.id)), [groups, selection.selected]);
    const tower = useShowInTower({ surface, onShow, onCamera, cameras });
    // The selection belongs to what is listed: a different layer is a different list.
    const pickLayer = (next: string | null) => { setLayer(next); selection.clear(); };
    if (matrix.families.length === 0 && matrix.antiTotal === 0) return <NotSetUp title={t.notSetUpTitle} body={t.notSetUpBody} />;
    const layerName = (l: string) => s.layers[l as keyof typeof s.layers] ?? s.layers.other;
    const light = (family: string, refs: string[]) => {
        surface.setFamily(family); // asks the patterns question, narrowed to this family (the scene's "{family} only" chip clears it)
        onShow(refs);
        setActive({ family, stations: new Set(refs.flatMap((r) => stationOfRef(surface.stations, r) ?? [])).size });
    };

    if (previewing && chosen.length > 0) {
        return (
            <AntiPatternPreview
                graph={graph} index={index} labels={labels} source={source} surface={surface} onCompose={onCompose} onChanged={onChanged}
                onShow={onShow} onCamera={onCamera} cameras={cameras} groups={chosen} onBack={() => setPreviewing(false)}
            />
        );
    }

    return (
        <div data-testid="kg-patterns" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
            <Section title={t.matrixTitle}>
                <PatternMatrixTable
                    matrix={matrix} labels={labels} activeLayer={layer}
                    onFamily={(fam) => light(fam.id, fam.refs)} onAntiLayer={(l) => pickLayer(layer === l ? null : l)}
                />
            </Section>
            {active && <p role="status" data-testid="kg-patterns-lit" style={{ ...muted, margin: 0 }}>{counted(labels, 'familyLights', active.stations, { family: active.family })}</p>}
            {matrix.families.length > 0 && (
                <Section title={t.listTitle}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                        {matrix.families.map((fam) => (
                            <li key={fam.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <strong style={TYPE.subtitle}>{fam.id}</strong>
                                <span style={muted}>{counted(labels, 'file', fam.refs.length)}</span>
                                <ProvenanceBadge provenance="heuristic" labels={labels} />
                            </li>
                        ))}
                    </ul>
                    <p style={{ ...muted, margin: 0 }}>{t.listHint}</p>
                </Section>
            )}
            <Section title={t.antiTitle}>
                {groups.length === 0 && !layer ? <p style={{ ...muted, margin: 0 }}>{t.antiNone}</p> : (
                    <AntiPatternList
                        groups={groups} labels={labels} index={index} selection={selection} canShow={tower.canShow} onShow={(g) => tower.show([g])}
                        layerName={layer ? layerName(layer) : null} onClearLayer={() => pickLayer(null)}
                    />
                )}
            </Section>
            {groups.length > 0 && (
                <PatternsFooter labels={labels} count={chosen.length} action={counted(labels, 'previewFix', chosen.length)} onAction={() => setPreviewing(true)} />
            )}
        </div>
    );
}
