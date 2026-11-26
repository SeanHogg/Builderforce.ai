/**
 * The Simulate drawer. Execution is not available in the view, so what it shows is a SIMULATION:
 * a deterministic walk of the path's hops using the values the host recorded (when it can) and
 * the ones the person edits. The stepper shares the path strip's step. *Run for real* and *Save
 * as <name>.test.ts* hand FIXED requests to the agent through the composer; nothing here claims
 * a result the agent did not produce.
 */

import { useEffect, useMemo, useState } from 'react';
import { nodeIndex } from '../../graphModel';
import { fillTemplate } from '../../labels';
import { button, muted, primaryButton } from '../../styles';
import type { PanelProps } from '../registry';
import { stationNote } from '../pathNotes';
import { hopRouteLabels } from '../sequenceText';
import { LikelyWalk, StepControls } from '../StepControls';
import { transitionTableOf } from '../transitionTable';
import { simulate, stepAt } from '../simulate/simulateModel';
import { runRequest, saveTestRequest, testFileName } from '../simulate/simulateRequests';
import { SimulateInputs } from '../simulate/SimulateInputs';
import { SimulateCode, SimulateResult, SimulateVariables } from '../simulate/SimulateState';
import { useRecordedRun } from '../simulate/useRecordedRun';
import { Segmented } from '../ui';
import { Section } from './ui';

export function SimulatePanel({ graph, labels, surface, source, rootId, onCompose }: PanelProps) {
    const t = labels.surface.simulate;
    const stops = surface.path.stops;
    const { run } = useRecordedRun(source, rootId, useMemo(() => stops.map((s) => s.id), [stops]));
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [stubs, setStubs] = useState<ReadonlySet<string>>(new Set());
    const [sent, setSent] = useState<'run' | 'test' | null>(null);
    /** Where the walk starts: the entry (stop 0) or the stop the person is on when they choose it. */
    const [startAt, setStartAt] = useState(0);
    const pathKey = useMemo(() => stops.map((s) => s.id).join('|'), [stops]);
    // Another path is another simulation: its edits, stubs and start belong to the old one.
    useEffect(() => { setEdits({}); setStubs(new Set()); setSent(null); setStartAt(0); }, [pathKey]);
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const transitions = useMemo(() => transitionTableOf(graph, surface.stations), [graph, surface.stations]);
    const steps = useMemo(() => {
        const notes = new Map(stops.flatMap((s) => { const n = stationNote(surface.stations.byId.get(s.id), labels); return n ? [[s.id, n] as const] : []; }));
        return simulate({
            path: { stops: surface.path.stops.slice(startAt), hops: surface.path.hops.slice(startAt) }, recorded: run, edits, stubs, labels, notes,
            routeLabels: hopRouteLabels(surface.path, surface.stations.byId, index), transitions, stations: surface.stations.byId,
        });
    }, [surface.path, surface.stations.byId, stops, run, edits, stubs, labels, index, startAt, transitions]);
    if (stops.length === 0) return <p style={{ ...muted, margin: 0 }}>{t.pathEmpty}</p>;

    const last = stops.length - 1;
    const at = Math.min(Math.max(surface.step, 0), last);
    const current = stepAt(steps, at - startAt)!;
    const values = { ...Object.fromEntries((run?.values ?? []).filter((v) => v.direction === 'in').map((v) => [v.name, v.value])), ...edits };
    const stubNames = stops.filter((s) => stubs.has(s.id)).map((s) => s.name);
    const file = testFileName(surface.path);
    const send = (kind: 'run' | 'test') => {
        onCompose?.(kind === 'run' ? runRequest(surface.path, values, labels) : saveTestRequest(surface.path, values, stubNames, labels));
        setSent(kind);
    };
    const edit = (name: string, value: string | null) => { setEdits((e) => { const { [name]: _drop, ...rest } = e; return value === null ? rest : { ...rest, [name]: value }; }); setSent(null); };
    const toggleStub = (id: string) => { setSent(null); setStubs((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; }); };

    return (
        <div data-testid="kg-simulate" style={{ display: 'grid', gap: 16 }}>
            <p data-testid="kg-sim-banner" style={{ ...muted, margin: 0 }}>{t.simulatedBanner}</p>
            <Section title={t.pathTitle}>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {stops.map((s, i) => (
                        <li key={s.id}>
                            <button type="button" aria-current={i === at ? 'step' : undefined} style={{ ...button, ...(i === at ? primaryButton : null) }} onClick={() => surface.setStep(i)}>{s.name}</button>
                        </li>
                    ))}
                </ol>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <StepControls at={at} last={last} labels={labels} onStep={surface.setStep} />
                    <span aria-live="polite" style={muted}>{fillTemplate(labels.surface.pathStep, { n: at + 1, total: stops.length })}</span>
                </div>
            </Section>
            <Section title={t.startFrom}>
                <Segmented
                    label={t.startFrom} value={startAt === 0 ? 'entry' : 'stop'}
                    onChange={(id) => { setStartAt(id === 'entry' ? 0 : at); setSent(null); }}
                    items={[{ id: 'entry', label: t.startEntry }, { id: 'stop', label: t.startStop, disabled: at === 0 && startAt === 0 }]}
                />
            </Section>
            <Section title={t.valuesLabel}>
                <SimulateInputs run={run} path={surface.path} labels={labels} edits={edits} stubs={stubs} onEdit={edit} onPreset={(v) => { setEdits(v); setSent(null); }} onStub={toggleStub} />
            </Section>
            <SimulateCode step={current} labels={labels} />
            <LikelyWalk from={stops[at]!.name} hops={current.walk} labels={labels} />
            <SimulateVariables step={current} labels={labels} />
            <SimulateResult step={current} labels={labels} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" style={onCompose ? primaryButton : button} disabled={!onCompose} onClick={() => send('run')}>{t.run}</button>
                <button type="button" style={button} disabled={!onCompose} onClick={() => send('test')}>{fillTemplate(t.saveTest, { file })}</button>
                {sent && <span role="status" style={muted}>{t.sent}</span>}
            </div>
            {!onCompose && <p style={{ ...muted, margin: 0 }}>{t.noComposer}</p>}
            <p style={{ ...muted, margin: 0 }}>{t.note}</p>
        </div>
    );
}
