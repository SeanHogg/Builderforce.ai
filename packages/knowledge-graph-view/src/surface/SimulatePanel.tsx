/**
 * Simulate-with-values mode. Inputs are the entry-point values; prev / next steps the journey
 * (or, with no journey, the trace `TracePanel` draws) and shows the values carried on that hop.
 * Nothing is executed — `simulate` only walks the hops. It is a mode: it takes the right rail
 * in place of Act, and each hop it shows moves the journey step (`onStep`) so the stage follows.
 */

import { useEffect, useMemo, useState } from 'react';
import { traceGraph, type KnowledgeGraph, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { button, muted, primaryButton } from '../styles';
import type { PathModel } from './path';
import { hopsFromEntry, hopsFromStops, hopsFromTrace, simulate, type CarriedValue, type JourneyHop } from './simulate';

/** The hops `TracePanel` draws from `traceGraph` for `from`. A missing export or a bad ref is an empty journey, not a throw. */
function traceHops(graph: KnowledgeGraph, from: string): JourneyHop[] {
    try {
        const walked = traceGraph(graph, from as NodeRef);
        return hopsFromTrace(walked.steps);
    } catch {
        return [];
    }
}

export interface SimulatePanelProps {
    graph: KnowledgeGraph;
    /** The selected mark, used as the trace start and by "Use the selected mark". */
    from: string | null;
    /** The selected mark's name, for the entry line and the toggle. */
    fromName?: string;
    path: PathModel;
    labels: KnowledgeGraphLabels;
    /** Moves the journey step to the stop the shown hop leaves from, so the stage and the PathStrip highlight it. */
    onStep?(stopIndex: number): void;
    onClose(): void;
}

export function SimulatePanel({ graph, from, fromName, path, labels, onStep, onClose }: SimulatePanelProps) {
    const t = labels.surface.simulate;
    const [rows, setRows] = useState<CarriedValue[]>([{ name: '', value: '' }]);
    const [entry, setEntry] = useState<string | null>(null);
    const [at, setAt] = useState(0);
    const pathKey = path.stops.map((s) => s.id).join('|');
    useEffect(() => { setEntry(null); setAt(0); }, [pathKey, from]);

    const hops = useMemo(() => {
        const journey = hopsFromStops(path.stops, path.hops.map((h) => h.kind));
        const base = journey.length > 0 ? journey : from ? traceHops(graph, from) : [];
        return hopsFromEntry(base, entry ?? path.stops[0]?.id ?? from ?? '');
    }, [graph, from, path, entry]);
    const steps = useMemo(() => simulate({ values: rows, hops }), [rows, hops]);
    const last = Math.max(steps.length - 1, 0);
    const current = steps[Math.min(at, last)];
    const stopAt = current ? path.stops.findIndex((s) => s.id === current.from) : -1;
    useEffect(() => { if (stopAt >= 0) onStep?.(stopAt); }, [stopAt, onStep]);
    const entryLabel = (entry && (path.stops.find((s) => s.id === entry)?.name ?? (entry === from ? fromName : entry)))
        || path.stops[0]?.name || fromName || from || '';

    const setRow = (i: number, patch: Partial<CarriedValue>) => {
        setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
        setAt(0);
    };

    return (
        <aside
            data-simulate-mode role="region" aria-label={t.modeTitle}
            style={{
                display: 'grid', alignContent: 'start', gap: 10, padding: 12, boxSizing: 'border-box', height: '100%', overflow: 'auto',
                background: cssVar('panel'), color: cssVar('text'),
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <b>{t.modeTitle}</b>
                <button type="button" aria-label={t.modeClose} onClick={onClose} style={{ ...button, border: 0, minWidth: 24, padding: 0, color: cssVar('muted') }}>×</button>
            </div>
            <p style={{ ...muted, margin: 0 }}>{t.simulatedBanner}</p>
            {entryLabel
                ? <p style={{ ...muted, margin: 0 }}>{t.modeEntry}: {entryLabel}</p>
                : <p style={{ ...muted, margin: 0 }}>{t.modeEmpty}</p>}
            <div style={{ display: 'grid', gap: 6 }}>
                {rows.map((row, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input aria-label={t.modeName} value={row.name} onChange={(e) => setRow(i, { name: e.target.value })} style={field} />
                        <input aria-label={t.modeValue} value={row.value} onChange={(e) => setRow(i, { value: e.target.value })} style={field} />
                        <button type="button" aria-label={fillTemplate(t.modeRemove, { name: row.name || String(i + 1) })} style={button} onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}>×</button>
                    </div>
                ))}
                <button type="button" style={{ ...button, justifySelf: 'start' }} onClick={() => setRows((rs) => [...rs, { name: '', value: '' }])}>{t.modeAdd}</button>
            </div>
            {from && (
                <button type="button" style={{ ...button, justifySelf: 'start' }} onClick={() => { setEntry(from); setAt(0); }}>{t.modeUseSelected}</button>
            )}
            {steps.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.modeNoHops}</p> : current && (
                <div data-sim-hop={current.index} style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button type="button" aria-label={t.modeBack} disabled={at <= 0} style={button} onClick={() => setAt((n) => Math.max(0, n - 1))}>‹</button>
                        <span aria-live="polite" style={muted}>{fillTemplate(t.modeStep, { n: Math.min(at, last) + 1, total: steps.length })}</span>
                        <button type="button" aria-label={t.modeNext} disabled={at >= last} style={primaryButton} onClick={() => setAt((n) => Math.min(last, n + 1))}>›</button>
                    </div>
                    <b>{fillTemplate(t.modeHop, { from: current.from, to: current.to })}</b>
                    <span style={muted}>{t.modeCarried}</span>
                    {current.carried.length === 0
                        ? <p style={{ ...muted, margin: 0 }}>{t.noVars}</p>
                        : (
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
                                {current.carried.map((v) => <li key={v.name} data-carried={v.name}><b>{v.name}</b> = {v.value}</li>)}
                            </ul>
                        )}
                </div>
            )}
        </aside>
    );
}

const field = { flex: 1, minWidth: 0, minHeight: 28, font: 'inherit' } as const;
