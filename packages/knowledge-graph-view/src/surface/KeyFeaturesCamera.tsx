/**
 * The Key features camera: what the product does, grouped into capabilities, API endpoints, entry points, patterns
 * in use and the most depended-on parts — all from the deterministic `keyFeaturesOf` model. A card selects its
 * station or its file; a cut group says how many it left out.
 */

import { useMemo } from 'react';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { chip } from '../styles';
import { FEATURE_GROUPS, keyFeaturesOf, type Feature, type FeatureGroup } from './features/keyFeatures';
import { counted } from './plural';
import type { SceneProps } from './registry';
import { TYPE } from './ui/type';

/** The number under a card's name, in the group's own words (entry points show none). */
function metaOf(group: FeatureGroup, f: Feature, labels: KnowledgeGraphLabels): string | null {
    switch (group) {
        case 'capabilities':
        case 'patterns': return counted(labels, 'file', f.count);
        case 'endpoints': return counted(labels, 'caller', f.count);
        case 'core': return counted(labels, 'dependent', f.count);
        case 'entryPoints': return null;
    }
}

function FeatureCard({ group, f, on, labels, onPick }: { group: FeatureGroup; f: Feature; on: boolean; labels: KnowledgeGraphLabels; onPick(f: Feature): void }) {
    const meta = metaOf(group, f, labels);
    return (
        <button
            type="button" data-feature={f.id} aria-pressed={on} title={f.detail} onClick={() => onPick(f)}
            style={{ ...chip(on), borderRadius: 10, display: 'grid', gap: 2, padding: '6px 12px', textAlign: 'start', whiteSpace: 'normal', minWidth: 0, maxWidth: '100%' }}
        >
            <span style={{ ...TYPE.monoName, color: cssVar('text'), overflowWrap: 'anywhere' }}>{f.label}</span>
            {f.detail && f.detail !== f.label && <span style={{ ...TYPE.monoMeta, overflowWrap: 'anywhere' }}>{f.detail}</span>}
            {meta && <span style={TYPE.meta}>{meta}</span>}
        </button>
    );
}

export function KeyFeaturesCamera({ graph, labels, selected, onSelect, surface }: SceneProps) {
    const s = labels.surface.keyFeatures;
    const features = useMemo(() => keyFeaturesOf(graph, surface.stations), [graph, surface.stations]);
    const pick = (f: Feature): void => {
        if (f.ref) onSelect(f.ref);
        else if (f.stationId) surface.selectStation(f.stationId);
    };
    const isOn = (f: Feature): boolean => (f.ref ? selected === f.ref : f.stationId !== undefined && surface.station?.id === f.stationId);
    return (
        <div data-testid="kg-features" role="group" aria-label={s.title} style={{ display: 'grid', gap: 14, padding: 12, color: cssVar('text'), boxSizing: 'border-box' }}>
            <h3 style={TYPE.sectionHeading}>{s.title}</h3>
            <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{s.description}</p>
            {FEATURE_GROUPS.map((g) => {
                const list = features[g];
                const left = list.total - list.items.length;
                return (
                    <section key={g} data-group={g} aria-label={s.groups[g]} style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                        <h4 style={{ ...TYPE.subtitle, color: cssVar('text') }}>{s.groups[g]}</h4>
                        {list.items.length === 0 ? <p style={{ ...TYPE.meta, margin: 0 }}>{s.empty[g]}</p> : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {list.items.map((f) => <FeatureCard key={f.id} group={g} f={f} on={isOn(f)} labels={labels} onPick={pick} />)}
                            </div>
                        )}
                        {left > 0 && <p style={{ ...TYPE.meta, margin: 0 }}>{counted(labels, 'moreFeatures', left)}</p>}
                    </section>
                );
            })}
        </div>
    );
}
