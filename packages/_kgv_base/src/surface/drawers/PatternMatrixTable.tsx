/** The family-by-layer matrix of the Patterns drawer. A family chip lights its files; a non-empty Anti-pattern cell narrows the list below to that layer. */

import type { KnowledgeGraphLabels } from '../../labels';
import { fillTemplate } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { chip } from '../../styles';
import { TYPE } from '../ui/type';
import type { PatternFamily, PatternMatrix } from './patternsModel';

const cell = { textAlign: 'center', padding: '6px 8px', fontSize: TYPE.body.fontSize, borderBottom: `1px solid ${cssVar('border')}` } as const;

export interface PatternMatrixTableProps {
    matrix: PatternMatrix;
    labels: KnowledgeGraphLabels;
    /** The layer the anti-pattern list is narrowed to. */
    activeLayer: string | null;
    onFamily(family: PatternFamily): void;
    onAntiLayer(layer: string): void;
}

export function PatternMatrixTable({ matrix, labels, activeLayer, onFamily, onAntiLayer }: PatternMatrixTableProps) {
    const s = labels.surface, t = s.patterns;
    const layerName = (layer: string) => s.layers[layer as keyof typeof s.layers] ?? s.layers.other;
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                    <tr>
                        <th scope="col" style={{ ...cell, textAlign: 'start' }} />
                        {matrix.layers.map((l) => <th key={l} scope="col" style={{ ...cell, color: cssVar('muted'), fontWeight: 600 }}>{layerName(l)}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {matrix.families.map((fam) => (
                        <tr key={fam.id}>
                            <th scope="row" style={{ ...cell, textAlign: 'start' }}>
                                <button type="button" data-family={fam.id} style={{ ...chip(false), minHeight: 32 }} onClick={() => onFamily(fam)}>{fam.id}</button>
                            </th>
                            {matrix.layers.map((l) => {
                                const n = fam.byLayer[l] ?? 0;
                                return (
                                    <td key={l} style={{ ...cell, background: n ? `color-mix(in srgb, ${cssVar('accent')} ${Math.min(60, 15 + n * 10)}%, transparent)` : 'transparent' }} aria-label={fillTemplate(t.cellAria, { family: fam.id, layer: layerName(l), count: n })}>
                                        {n || ''}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                    <tr data-row="anti">
                        <th scope="row" style={{ ...cell, textAlign: 'start', color: cssVar('violation') }}>{t.antiRow}</th>
                        {matrix.layers.map((l) => {
                            const n = matrix.anti[l] ?? 0;
                            const on = activeLayer === l;
                            return (
                                <td key={l} data-anti-cell={l} style={{ ...cell, background: n ? `color-mix(in srgb, ${cssVar('violation')} ${Math.min(60, 15 + n * 10)}%, transparent)` : 'transparent', ...(on ? { outline: `2px solid ${cssVar('violation')}`, outlineOffset: -2 } : {}) }} aria-label={fillTemplate(t.cellAria, { family: t.antiRow, layer: layerName(l), count: n })}>
                                    {n > 0
                                        ? <button type="button" aria-pressed={on} aria-label={fillTemplate(t.cellAria, { family: t.antiRow, layer: layerName(l), count: n })} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', minHeight: 24 }} onClick={() => onAntiLayer(l)}>{n.toLocaleString()}</button>
                                        : ''}
                                </td>
                            );
                        })}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}
