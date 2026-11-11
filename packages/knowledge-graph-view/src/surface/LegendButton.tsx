/**
 * The Legend button in the camera bar: an icon that opens the full key (a `Menu` in dialog mode),
 * so what the marks mean is one click away even with every side panel hidden. Three sections:
 *   Shapes  — EVERY mark type in `MARK_TYPE_ORDER` (the ONE `ShapeLegend`, `describe` on), the
 *             types drawn now first and tagged "on screen";
 *   Lines   — a route's colour, the untested hop and the cycle hop, drawn with the map's own dashes;
 *   Colour  — fill follows the active overlay preset; faded marks are outside the question's answer.
 * Tokens only; the panel is `min(420px, 92vw)` wide and scrolls inside 60vh.
 */

import { useEffect, useRef, type CSSProperties } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { kindLabel } from '../names';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { MARK_TYPE_ORDER, type MarkType } from '../shapes';
import { list, muted } from '../styles';
import { DASH_CYCLE, DASH_PATTERNS, DASH_SOLID, DASH_UNTESTED } from '../stage/types';
import { zoomButton } from './CameraBar';
import type { PresetId } from './overlays';
import { ShapeLegend } from './ShapeLegend';
import { Menu } from './ui';
import { TYPE } from './ui/type';

export interface LegendButtonProps {
    labels: KnowledgeGraphLabels;
    /** The mark types drawn now (legend order); listed first and tagged "on screen". */
    present: readonly MarkType[];
    /** The active overlay preset (`surface.preset`): the colour section names it. */
    preset: PresetId | 'custom';
}

const PANEL: CSSProperties = { width: 'min(420px, 92vw)', maxHeight: '60vh', overflowY: 'auto', padding: '12px 14px', gap: 12 };
const TRIGGER: CSSProperties = { ...zoomButton, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };

/** The trigger's icon: three marks, each with its key line. Decorative: the button's label names it. */
function KeyIcon() {
    const ink = cssVar('text');
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'block' }}>
            <rect x="1.5" y="1.5" width="3.5" height="3.5" fill={ink} />
            <circle cx="3.25" cy="8" r="1.9" fill={ink} />
            <path d="M3.25 11.2 L5.2 14.6 L1.3 14.6 Z" fill={ink} />
            {[3.25, 8, 13].map((y) => <line key={y} x1="7.5" x2="14.5" y1={y} y2={y} stroke={cssVar('muted')} strokeWidth="1.3" strokeLinecap="round" />)}
        </svg>
    );
}

/** A route sample drawn with the map's own dash pattern (`stage/types` DASH_PATTERNS). */
function LineSample({ tone, dash }: { tone: ThemeTone; dash: number }) {
    const [on, off] = DASH_PATTERNS[dash] ?? [0, 0];
    return (
        <svg width="40" height="10" viewBox="0 0 40 10" aria-hidden="true" style={{ flex: 'none' }}>
            <line x1="1" x2="39" y1="5" y2="5" stroke={cssVar(tone)} strokeWidth="3" {...(on > 0 ? { strokeDasharray: `${on} ${off}` } : {})} />
        </svg>
    );
}

const LINE_ROWS: ReadonlyArray<{ id: string; tone: ThemeTone; dash: number }> = [
    { id: 'lineFlow', tone: 'line1', dash: DASH_SOLID },
    { id: 'lineUntested', tone: 'violation', dash: DASH_UNTESTED },
    { id: 'lineCycle', tone: 'line2', dash: DASH_CYCLE },
];

const heading: CSSProperties = { ...TYPE.meta, margin: 0 };
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, ...TYPE.meta, color: cssVar('text') };

function LegendPanel({ labels, present, preset }: LegendButtonProps) {
    const box = useRef<HTMLDivElement>(null);
    // Focus moves into the key when it opens (Menu returns it to the button on Escape).
    useEffect(() => { box.current?.focus(); }, []);
    const shown = new Set(present);
    const types = [...MARK_TYPE_ORDER.filter((t) => shown.has(t)), ...MARK_TYPE_ORDER.filter((t) => !shown.has(t))];
    const linesTitle = kindLabel(labels, 'linesTitle');
    const colourTitle = kindLabel(labels, 'colourTitle');
    return (
        <div ref={box} tabIndex={-1} data-testid="kg-legend-panel" style={{ display: 'grid', gap: 12, outline: 'none', minWidth: 0 }}>
            <ShapeLegend types={types} labels={labels} describe present={present} />
            <section aria-label={linesTitle} data-testid="kg-legend-lines" style={{ display: 'grid', gap: 4 }}>
                <span style={heading}>{linesTitle}</span>
                <ul style={{ ...list, gap: 6 }}>
                    {LINE_ROWS.map((r) => (
                        <li key={r.id} data-line={r.id} style={row}>
                            <LineSample tone={r.tone} dash={r.dash} />
                            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{kindLabel(labels, r.id)}</span>
                        </li>
                    ))}
                </ul>
            </section>
            <section aria-label={colourTitle} data-testid="kg-legend-colour" style={{ display: 'grid', gap: 4 }}>
                <span style={heading}>{colourTitle}</span>
                <p style={{ ...muted, margin: 0 }}>{fillTemplate(kindLabel(labels, 'colourNote'), { preset: labels.surface.presets[preset] })}</p>
                <p style={{ ...muted, margin: 0 }}>{kindLabel(labels, 'fadedNote')}</p>
            </section>
        </div>
    );
}

export function LegendButton(props: LegendButtonProps) {
    const name = kindLabel(props.labels, 'keyButton');
    return (
        <Menu trigger={<KeyIcon />} triggerLabel={name} title={name} label={props.labels.legendLabel} triggerStyle={TRIGGER} panelStyle={PANEL}>
            <LegendPanel {...props} />
        </Menu>
    );
}
