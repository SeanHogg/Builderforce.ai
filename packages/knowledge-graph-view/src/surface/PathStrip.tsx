/**
 * The path strip: the stops of the selected line (or, later, a trace) in a row, the edge
 * between each pair (its kind and how many references make it), and step back / forward.
 * A hop that skips or climbs a layer says so in the colour the trace uses.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { edgeKindLabel } from '../names';
import { cssVar } from '../scene/themeColors';
import { button, chip, muted } from '../styles';
import type { PathModel } from './path';

export interface PathStripProps {
    path: PathModel;
    step: number;
    labels: KnowledgeGraphLabels;
    onStep(n: number): void;
}

export function PathStrip({ path, step, labels, onStep }: PathStripProps) {
    const s = labels.surface;
    const last = path.stops.length - 1;
    const at = Math.min(Math.max(step, 0), Math.max(last, 0));
    return (
        <section aria-label={s.pathTitle} data-testid="kg-path" style={{ display: 'grid', gap: 6, padding: '8px 12px', borderTop: `1px solid ${cssVar('border')}` }}>
            {path.stops.length === 0 ? <p style={{ ...muted, margin: 0 }}>{s.pathEmpty}</p> : (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 12 }}>{s.pathTitle}</strong>
                        <button type="button" style={button} disabled={at <= 0} onClick={() => onStep(at - 1)} aria-label={s.pathBack} title={s.pathBack}>
                            <span aria-hidden="true">‹</span>
                        </button>
                        <button type="button" style={button} disabled={at >= last} onClick={() => onStep(at + 1)} aria-label={s.pathNext} title={s.pathNext}>
                            <span aria-hidden="true">›</span>
                        </button>
                        <span aria-live="polite" style={muted}>{fillTemplate(s.pathStep, { n: at + 1, total: path.stops.length })}</span>
                    </div>
                    <ol style={{ listStyle: 'none', margin: 0, padding: '0 0 2px', display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto' }}>
                        {path.stops.map((stop, i) => {
                            const hop = i > 0 ? path.hops[i - 1] : undefined;
                            const bad = hop?.verdict === 'skips' || hop?.verdict === 'upward';
                            return (
                                <li key={stop.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                                    {hop && (
                                        <span style={{ ...muted, color: cssVar(bad ? 'violation' : 'muted') }} data-hop={hop.verdict ?? 'ok'}>
                                            {fillTemplate(s.pathHop, { kind: edgeKindLabel(labels, hop.kind), count: hop.count })}
                                            {hop.verdict === 'skips' ? ` · ${labels.traceSkips}` : hop.verdict === 'upward' ? ` · ${labels.traceUpward}` : ''}
                                        </span>
                                    )}
                                    <button type="button" aria-current={i === at ? 'step' : undefined} style={chip(i === at)} onClick={() => onStep(i)}>
                                        {stop.name}
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                </>
            )}
        </section>
    );
}
