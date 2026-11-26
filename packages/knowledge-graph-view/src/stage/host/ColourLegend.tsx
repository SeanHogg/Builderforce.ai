/**
 * The Colour-by legend (the design's `#legend`), bottom-left of the stage: "Colour by" with a mini segment of the overlay
 * presets (Risk, Quality, Activity, Ownership; Custom opens the overlay editor as a popover) and a fold chevron, a row of
 * swatches describing the active preset's colours and, unfolded, the shapes. While a comparison is open it reads "Showing
 * changes" with the new / changed / goes-away swatches. Swatches and shapes wrap; colours are theme tokens only.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import { cmp } from '../../order';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import type { MarkType } from '../../shapes';
import { OverlayMenu } from '../../surface/OverlayMenu';
import { lineTone, PRESET_ORDER, SEVERITY_TONES, type PresetId } from '../../surface/overlays';
import { ShapeLegend } from '../../surface/ShapeLegend';
import type { SurfaceModel } from '../../surface/useSurface';
import { Glyph } from '../../surface/ui/glyphs';
import { TYPE } from '../../surface/ui/type';

type Swatch = { fill: string; text: string; wide?: boolean };
const GRADIENT = `linear-gradient(90deg, ${cssVar(SEVERITY_TONES[0])}, ${cssVar(SEVERITY_TONES[4])})`;
const tone = (t: ThemeTone): string => cssVar(t);

/** The active preset's swatches (what its colours say), or the comparison's. */
function swatchesOf(preset: PresetId | 'custom', comparing: boolean, surface: SurfaceModel, labels: KnowledgeGraphLabels): Swatch[] {
    const l = labels.legend, card = labels.surface.map.card;
    if (comparing) return [{ fill: tone('agrees'), text: l.diffNew! }, { fill: tone('cycle'), text: l.changed! }, { fill: tone('violation'), text: l.diffGone! }];
    switch (preset) {
        case 'risk': return [{ fill: tone(SEVERITY_TONES[0]), text: l.swatchFine! }, { fill: tone(SEVERITY_TONES[3]), text: l.swatchLook! }];
        case 'quality': return [{ fill: tone(SEVERITY_TONES[0]), text: card.testReached }, { fill: tone(SEVERITY_TONES[4]), text: card.testNone }];
        case 'activity': return [{ fill: GRADIENT, text: l.swatchQuiet!, wide: true }];
        case 'ownership': {
            const owners = [...new Set(surface.stations.stations.map((s) => s.owner).filter((o): o is string => !!o))].sort(cmp);
            return owners.slice(0, 8).map((o, i) => ({ fill: tone(lineTone(i)), text: o }));
        }
        default: return [{ fill: GRADIENT, text: labels.surface.metricNames[surface.overlay.bindings.colour], wide: true }];
    }
}

const mini: CSSProperties = { display: 'inline-flex', border: `1px solid ${cssVar('border')}`, borderRadius: 4, overflow: 'hidden' };
const miniButton = (on: boolean): CSSProperties => ({
    height: 22, padding: '0 8px', border: 0, borderInlineEnd: `1px solid ${cssVar('border')}`, cursor: 'pointer', fontSize: 11.5, font: 'inherit',
    background: on ? cssVar('accentSoft') : 'none', color: cssVar(on ? 'text' : 'muted'), fontWeight: on ? 600 : 400,
});
const item: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };

export interface ColourLegendProps {
    labels: KnowledgeGraphLabels;
    surface: SurfaceModel;
    /** The mark types on screen (the shapes, when unfolded). */
    types: readonly MarkType[];
    /** A comparison is open: "Showing changes". */
    comparing: boolean;
    narrow: boolean;
    /** The scale sentence, under the legend. */
    scale?: ReactNode;
}

export function ColourLegend({ labels, surface, types, comparing, narrow, scale }: ColourLegendProps) {
    const [open, setOpen] = useState(false);
    const l = labels.legend, s = labels.surface;
    const swatches = swatchesOf(surface.preset, comparing, surface, labels);
    const fold = open ? l.shapesHide! : l.shapesShow!;
    return (
        <div data-colour-legend style={{ position: 'absolute', zIndex: 2, insetInlineStart: 10, bottom: 10, maxWidth: narrow ? 'calc(100% - 64px)' : 'calc(100% - 70px)', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 7, padding: '8px 10px', border: `1px solid ${cssVar('border')}`, borderRadius: 6, background: cssVar('panel'), color: cssVar('muted'), fontSize: 11.5, maxWidth: '100%', boxSizing: 'border-box' }}>
                {comparing
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={TYPE.sectionHeading}>{l.showingChanges}</span></div>
                    : (
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <span style={TYPE.sectionHeading}>{l.colourBy}</span>
                            <span role="group" aria-label={l.colourBy} style={mini}>
                                {PRESET_ORDER.map((id) => (
                                    <button key={id} type="button" aria-pressed={surface.preset === id} onClick={() => surface.setPreset(id)} style={miniButton(surface.preset === id)}>{s.presets[id]}</button>
                                ))}
                            </span>
                            <OverlayMenu
                                labels={labels} stations={surface.stations.stations} bindings={surface.overlay.bindings} preset={surface.preset} coverage={surface.coverage}
                                onPreset={surface.setPreset} onChannel={surface.setChannel} onPins={surface.setPins} narrow={narrow}
                            />
                            <button type="button" aria-label={fold} title={fold} aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ marginInlineStart: 'auto', width: 22, height: 22, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span aria-hidden="true" style={{ display: 'inline-flex', transform: open ? 'none' : 'rotate(-90deg)' }}><Glyph><path d="M4.5 6.5 8 10l3.5-3.5" /></Glyph></span>
                            </button>
                        </div>
                    )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                    {swatches.map((w) => (
                        <span key={w.text} style={item}>
                            <i aria-hidden="true" style={{ display: 'inline-block', width: w.wide ? 44 : 14, height: 10, borderRadius: 2, flex: 'none', background: w.fill }} />
                            {w.text}
                        </span>
                    ))}
                </div>
                {open && !comparing && types.length > 0 && <div style={{ paddingTop: 7, borderTop: `1px solid ${cssVar('border')}` }}><ShapeLegend types={types} labels={labels} /></div>}
            </div>
            {scale && <div style={{ pointerEvents: 'auto', padding: '2px 8px', borderRadius: 6, background: cssVar('panel'), ...TYPE.meta }}>{scale}</div>}
        </div>
    );
}

