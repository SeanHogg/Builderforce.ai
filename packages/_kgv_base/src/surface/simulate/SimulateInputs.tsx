/**
 * The simulation's inputs: argument presets, each argument as recorded against edited, and which
 * stops are stubbed. With no recorded values it says so and offers nothing to edit: values are
 * never invented. The layout is grids of `minmax(0, 1fr)` columns that wrap, so at a phone's 360px
 * everything stacks into one column and nothing overflows.
 */

import type { RecordedRun } from '../../fixPorts';
import type { KnowledgeGraphLabels } from '../../labels';
import { fillTemplate } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { chip, input, muted } from '../../styles';
import { TYPE } from '../ui/type';
import type { PathModel } from '../path';
import { argumentNames } from './simulateModel';

export interface SimulateInputsProps {
    run: RecordedRun | null;
    path: PathModel;
    labels: KnowledgeGraphLabels;
    edits: Readonly<Record<string, string>>;
    stubs: ReadonlySet<string>;
    onEdit(name: string, value: string | null): void;
    onPreset(values: Record<string, string>): void;
    onStub(stopId: string): void;
}

/** As many columns as fit at 140px, one when narrower; `minmax(0, 1fr)` so long values wrap instead of widening the drawer. */
const columns = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 6, minWidth: 0 } as const;

export function SimulateInputs({ run, path, labels, edits, stubs, onEdit, onPreset, onStub }: SimulateInputsProps) {
    const t = labels.surface.simulate;
    const names = argumentNames(run);
    const recordedOf = (name: string) => run?.values.find((v) => v.direction === 'in' && v.name === name)?.value ?? '';
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
            {names.length === 0 ? <p data-testid="kg-sim-no-values" style={{ ...muted, margin: 0 }}>{t.noRecorded}</p> : (
                <>
                    <div role="group" aria-label={t.presets} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" style={chip(Object.keys(edits).length === 0)} onClick={() => onPreset({})}>{t.presetRecorded}</button>
                        {(run?.presets ?? []).map((p) => <button key={p.name} type="button" style={chip(false)} onClick={() => onPreset(p.values)}>{p.name}</button>)}
                    </div>
                    <ul data-testid="kg-sim-args" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
                        {names.map((name) => (
                            <li key={name} style={{ ...columns, alignItems: 'start' }}>
                                <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                                    <span style={{ ...TYPE.monoValue, fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</span>
                                    <span style={{ ...muted, overflowWrap: 'anywhere' }}>{t.colRecorded}: <span style={{ ...TYPE.mono, color: cssVar('text') }}>{recordedOf(name)}</span></span>
                                </div>
                                <input
                                    aria-label={fillTemplate(t.editAria, { name })} value={edits[name] ?? ''} placeholder={recordedOf(name)}
                                    onChange={(e) => onEdit(name, e.target.value === '' ? null : e.target.value)} style={{ ...input, width: '100%', minWidth: 0, boxSizing: 'border-box', ...TYPE.monoValue }}
                                />
                            </li>
                        ))}
                    </ul>
                </>
            )}
            <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4, minWidth: 0 }}>
                <legend style={{ ...TYPE.subtitle, padding: 0 }}>{t.stubsTitle}</legend>
                <span style={muted}>{t.stubsHint}</span>
                {path.stops.map((s) => (
                    <label key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', ...TYPE.monoValue, minHeight: 28, minWidth: 0, overflowWrap: 'anywhere' }}>
                        <input type="checkbox" checked={stubs.has(s.id)} onChange={() => onStub(s.id)} />{s.name}
                    </label>
                ))}
            </fieldset>
        </div>
    );
}
