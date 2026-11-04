/**
 * A horizontal bar chart in hand-rolled SVG. Each row is a button — the label, the bar and the
 * number are ALL text a screen reader gets, so the rows are the chart's text equivalent. A bar
 * is as long as its share of the largest value; clicking one runs `onPick` (the view's
 * `onShow`). Tones are tokens, so both themes read.
 */

import { useId } from 'react';
import type { ThemeTone } from '../scene/themeColors';
import { cssVar } from '../scene/themeColors';
import { TAP } from '../styles';

export interface ChartRow { key: string; label: string; value: number; refs: string[] }

export interface BarChartProps {
    title: string;
    rows: readonly ChartRow[];
    tone: ThemeTone;
    onPick(refs: string[]): void;
}

const BAR_H = 8;

export function BarChart({ title, rows, tone, onPick }: BarChartProps) {
    const id = useId();
    const max = Math.max(1, ...rows.map((r) => r.value));
    return (
        <figure role="group" aria-labelledby={id} style={{ margin: 0, display: 'grid', gap: 2 }}>
            <figcaption id={id} style={{ fontSize: 12, fontWeight: 700, color: cssVar('text'), marginBlockEnd: 2 }}>{title}</figcaption>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
                {rows.map((r) => (
                    <li key={r.key}>
                        <button
                            type="button" aria-label={`${r.label}: ${r.value}`} onClick={() => onPick(r.refs)}
                            style={{
                                display: 'grid', gridTemplateColumns: 'minmax(0, 40%) minmax(0, 1fr) auto', alignItems: 'center', gap: 8, width: '100%',
                                minHeight: TAP, padding: '0 4px', border: 0, borderRadius: 6, background: 'transparent', color: cssVar('text'),
                                font: 'inherit', fontSize: 12, textAlign: 'start', cursor: 'pointer',
                            }}
                        >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                            <svg aria-hidden="true" width="100%" height={BAR_H} preserveAspectRatio="none" viewBox={`0 0 100 ${BAR_H}`} style={{ display: 'block' }}>
                                <rect x={0} y={0} width={100} height={BAR_H} rx={2} fill={cssVar('plane')} opacity={0.6} />
                                <rect x={0} y={0} width={Math.max(2, (r.value / max) * 100)} height={BAR_H} rx={2} fill={cssVar(tone)} />
                            </svg>
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, minWidth: 28, textAlign: 'end' }}>{r.value}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </figure>
    );
}
